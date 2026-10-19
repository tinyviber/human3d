import {normalizeMotionFile,type MotionFile} from './motion-file';
import idle from '../../../assets/motions/idle.json';
import walk from '../../../assets/motions/walk.json';
import reach from '../../../assets/motions/reach.json';
import squat from '../../../assets/motions/squat.json';
import ready from '../../../assets/motions/ready.json';
import forehand from '../../../assets/motions/forehand.json';
import baseballThrow from '../../../assets/motions/baseball-throw.json';
import punch from '../../../assets/motions/punch.json';
import novakDjokovicForehand from '../../../assets/motions/novak-djokovic-forehand.json';
import rogerFedererForehand from '../../../assets/motions/roger-federer-forehand.json';
import carlosAlcarazForehand from '../../../assets/motions/carlos-alcaraz-forehand.json';
import alexanderZverevForehand from '../../../assets/motions/alexander-zverev-forehand.json';
import daniilMedvedevForehand from '../../../assets/motions/daniil-medvedev-forehand.json';
import benSheltonForehand from '../../../assets/motions/ben-shelton-forehand.json';
import alexanderBublikForehand from '../../../assets/motions/alexander-bublik-forehand.json';
import francesTiafoeForehand from '../../../assets/motions/frances-tiafoe-forehand.json';
import holgerRuneForehand from '../../../assets/motions/holger-rune-forehand.json';
import alexDeMinaurForehand from '../../../assets/motions/alex-de-minaur-forehand.json';
import alejandroDavidovichFokinaForehand from '../../../assets/motions/alejandro-davidovich-fokina-forehand.json';
import flavioCobolliForehand from '../../../assets/motions/flavio-cobolli-forehand.json';
import marinCilicForehand from '../../../assets/motions/marin-cilic-forehand.json';
import karenKhachanovForehand from '../../../assets/motions/karen-khachanov-forehand.json';
import jakubMensikForehand from '../../../assets/motions/jakub-mensik-forehand.json';
import ignacioBuseForehand from '../../../assets/motions/ignacio-buse-forehand.json';
import felixAugerAliassimeForehand from '../../../assets/motions/felix-auger-aliassime-forehand.json';

/** The bundled motion envelopes, normalized once at module load and kept in
 * display order. Plain static imports — node-safe, so the service, the lab
 * and the scripts all read the same assets/motions/ files; dynamics-motion
 * envelopes normalize their display fields out of `dynamics.action`. */
export const MOTION_FILES:MotionFile[]=[idle,walk,reach,squat,ready,forehand,baseballThrow,punch,
 novakDjokovicForehand,rogerFedererForehand,carlosAlcarazForehand,alexanderZverevForehand,
 daniilMedvedevForehand,benSheltonForehand,alexanderBublikForehand,francesTiafoeForehand,
 holgerRuneForehand,alexDeMinaurForehand,alejandroDavidovichFokinaForehand,flavioCobolliForehand,
 marinCilicForehand,karenKhachanovForehand,jakubMensikForehand,ignacioBuseForehand,
 felixAugerAliassimeForehand]
 .map(f=>normalizeMotionFile(f))
 .sort((a,b)=>a.order-b.order);

export const motionFileById=(id:string)=>MOTION_FILES.find(f=>f.id===id);
