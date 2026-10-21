import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

type Profile={name:string;video:string;frames:{time:number}[]};
type LandmarkData={profiles:Record<string,Profile>};

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const data=JSON.parse(fs.readFileSync(path.join(root,'scripts/player-forehand-landmarks.json'),'utf8')) as LandmarkData;
const videoDir=path.join(root,'research/forehand-retargeting/videos');
const frameRoot=path.join(root,'research/forehand-retargeting/frames');
let extracted=0;

for(const [profileId,profile] of Object.entries(data.profiles)){
  const input=path.join(videoDir,profile.video);
  if(!fs.existsSync(input))throw new Error(`Missing source video for ${profile.name}: ${input}`);
  const videoName=path.basename(profile.video,path.extname(profile.video));
  const outputDir=path.join(frameRoot,videoName);
  fs.mkdirSync(outputDir,{recursive:true});
  for(const {time} of profile.frames){
    const stamp=time.toFixed(3);
    const output=path.join(outputDir,`${profileId}--t${stamp}s.jpg`);
    const result=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-ss',stamp,'-i',input,'-frames:v','1','-q:v','2',output],{stdio:'inherit'});
    if(result.error)throw result.error;
    if(result.status!==0||!fs.existsSync(output))throw new Error(`ffmpeg failed for ${profile.name} at ${stamp}s`);
    extracted++;
  }
}

console.log(`Extracted ${extracted} selected frames to ${path.relative(root,frameRoot)}`);
