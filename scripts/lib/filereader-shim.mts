/** Minimal FileReader surface for Node. three's GLTFExporter binary path reads
 * merged Blobs through `readAsArrayBuffer` + `onloadend`; Node has Blob but no
 * FileReader, so the CLI and the vitest glb-export suite both install this
 * before exporting. It covers exactly the surface the exporter touches
 * (result + onloadend + onerror, both read methods) — human.glb has zero
 * textures, so the canvas/image paths are unreachable and stay unshimmed.
 * In a real browser the native FileReader wins and this is a no-op. */
export function installFileReaderShim():void{
 if(typeof globalThis.FileReader==='function')return;
 class FileReaderShim{
  result:ArrayBuffer|string|null=null;
  onloadend:(()=>void)|null=null;
  onerror:((e:unknown)=>void)|null=null;
  // The exporter assigns onloadend synchronously AFTER calling this — promise
  // microtask timing makes the handler visible when it fires.
  readAsArrayBuffer(blob:Blob):void{
   blob.arrayBuffer().then(b=>{this.result=b;this.onloadend?.();},e=>{this.onerror?.(e);});
  }
  readAsDataURL(blob:Blob):void{
   blob.arrayBuffer().then(b=>{
    this.result=`data:${blob.type||'application/octet-stream'};base64,${Buffer.from(b).toString('base64')}`;
    this.onloadend?.();
   },e=>{this.onerror?.(e);});
  }
 }
 (globalThis as Record<string,unknown>).FileReader=FileReaderShim;
}
