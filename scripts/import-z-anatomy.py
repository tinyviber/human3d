"""Pack decoded source geometry and preserve all Z-Anatomy object identities.
Input files are pinned in assets/anatomy/z-anatomy/source.json. Ordinary bakes
use only this offline cache; Draco decoding is needed only for re-import.
"""
import argparse,hashlib,json,pathlib,re,subprocess,tempfile
import numpy as np
ROOT=pathlib.Path(__file__).resolve().parents[1]
COMMIT='28912432581accd7a1c62129d55f0e9758221d48'
EXPECTED_FILES={'z-muscles.glb': 'f290a69f84b899f1b9f2dc60c771f4e1cb12194f5bfb2be697d26de2c505ace9', 'z-skeleton.glb': '2d159eddbc12de45d84195fc56957b274e7086b00224c245f22ea9d8ea6409eb', 'z-skin.glb': '829dc9d782b66c0d0cf40b07c70070b31e82d446507b1f52410705b508e2a639'}
DEST=ROOT/'assets/anatomy/z-anatomy'
def main():
    parser=argparse.ArgumentParser();parser.add_argument('--source-dir',required=True);args=parser.parse_args()
    with tempfile.TemporaryDirectory(prefix='human3d-z-') as temp:
        prefix=pathlib.Path(temp)/'decoded';subprocess.run(['node',str(ROOT/'scripts/import-z-anatomy.mjs'),args.source_dir,str(prefix)],cwd=ROOT,check=True)
        manifest=json.loads(prefix.with_suffix('.json').read_text());
        if {f['file']:f['sha256'] for f in manifest['files']}!=EXPECTED_FILES:raise ValueError('source GLBs differ from the pinned conversion commit')
        binary=prefix.with_suffix('.bin').read_bytes();vertices=[];faces=[];ids=[];items=[];offset=0
        for i,item in enumerate(manifest['items']):
            v=np.frombuffer(binary,dtype='<f4',count=item['vertexCount']*3,offset=item['positions']).reshape(-1,3).copy()
            f=np.frombuffer(binary,dtype='<u4',count=item['triangleCount']*3,offset=item['indices']).reshape(-1,3).copy()
            # Tendons/aponeuroses and bones remain occluders, never muscles.
            if item['kind']=='muscle' and (item['material']=='Tendon' or re.search(r'tendon|tendinous|aponeurosis|trochlea|tendinous ring|iliotibial tract',item['name'],re.I)):item['kind']='connective'
            items.append({k:item[k] for k in ['name','group','material','kind','nodeName','vertexCount','triangleCount']});vertices.append(v);faces.append(f+offset);ids.append(np.full(len(f),i,dtype='<u2'));offset+=len(v)
        DEST.mkdir(parents=True,exist_ok=True);np.savez_compressed(DEST/'geometry.npz',vertices=np.concatenate(vertices),faces=np.concatenate(faces),mesh=np.concatenate(ids))
        provenance={'dataset':'Z-Anatomy','primaryURL':'https://github.com/Z-Anatomy/Models-of-human-anatomy','authors':['Gauthier Kervyn (Z-Anatomy)','The Database Center for Life Science (BodyParts3D)'],'license':'CC-BY-SA-4.0','licenseURL':'https://github.com/Z-Anatomy/Models-of-human-anatomy/blob/master/License.txt','conversionRepository':'https://github.com/SeemaBansal1/3d-human-body-anatomy','conversionCommit':COMMIT,'conversionScript':'pipeline/export_layers.py','files':[{**f,'url':f'https://raw.githubusercontent.com/SeemaBansal1/3d-human-body-anatomy/{COMMIT}/web/public/models/'+f['file'].replace('z-','')} for f in manifest['files']],'geometrySHA256':hashlib.sha256((DEST/'geometry.npz').read_bytes()).hexdigest(),'coordinateSystem':'metres, X anatomical left, Y up, Z anterior (glTF world-space)','changes':['Decode Draco and retain positions/triangles and original zname/zgroup metadata.','Classify explicitly named tendons/aponeuroses as non-muscle occluders. No anatomical outlines are drawn.'],'items':items}
        (DEST/'source.json').write_text(json.dumps(provenance,ensure_ascii=False,indent=2)+'\n');print('Packed',len(items),'structures;',sum(i['kind']=='muscle' for i in items),'muscle components')
if __name__=='__main__':main()
