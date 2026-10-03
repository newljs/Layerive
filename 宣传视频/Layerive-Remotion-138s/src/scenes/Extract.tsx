import {Interactive, interpolate, useCurrentFrame} from 'remotion';
import {Scene} from '../Scene';
import {Art, Body, Chapter, Cursor, Reveal, clamp, ease} from '../visuals';

export const Extract: React.FC = () => {
 const f=useCurrentFrame();
 return <Scene>
  <Chapter n="06" label="素材提取 · 从作品到素材"/>
  <Reveal style={{position:'absolute',left:90,top:160}}><Interactive.Div name="Extract headline" style={{fontSize:90,fontWeight:750}}>看中的元素，<span style={{color:'#63f3e1'}}>圈出来、提出来。</span></Interactive.Div><Body style={{marginTop:18,fontSize:36}}>把画面里的公交车，变成可继续创作的素材。</Body></Reveal>
  <div style={{position:'absolute',left:145,top:370,width:385,height:575,borderRadius:20,overflow:'hidden',border:'1px solid #ffffff60',boxShadow:'0 20px 70px #0008'}}><Art name="poster-clean"/>
   <div style={{position:'absolute',left:83,top:353,width:interpolate(f,[50,102],[0,109],clamp),height:interpolate(f,[50,102],[0,82],clamp),border:'3px solid #63f3e1',borderRadius:7,opacity:interpolate(f,[44,50],[0,1],ease)}}/>
  </div>
  <div style={{position:'absolute',left:590,top:625,fontSize:65,color:'#63f3e1',opacity:interpolate(f,[120,144],[0,1],ease)}}>→</div>
  <Interactive.Div name="Extract command" style={{position:'absolute',left:750,top:382,fontSize:32,color:'#bdafff',opacity:interpolate(f,[25,45],[0,1],ease)}}>{f<112?'选择「提取素材」，圈出公交车':f<202?'确认目标，提取中…':'提取结果'}</Interactive.Div>
  <Interactive.Div name="Bus result" style={{position:'absolute',left:749,top:443,width:1068,height:504,borderRadius:25,overflow:'hidden',border:'2px solid #63f3e177',background:'#fff',boxShadow:'0 30px 90px #0009',opacity:interpolate(f,[197,228],[0,1],ease),scale:interpolate(f,[197,235],[.95,1],ease)}}><Art name="bus" fit="contain"/></Interactive.Div>
  <div style={{opacity:interpolate(f,[38,49,108,128],[0,1,1,0],clamp)}}><Cursor x={interpolate(f,[50,102],[228,337],clamp)} y={interpolate(f,[50,102],[723,794],clamp)} click={f>=103&&f<112}/></div>
  <Reveal delay={243} style={{position:'absolute',left:750,top:977,fontSize:31,color:'#63f3e1'}}>从已有作品，获得新的创作素材。</Reveal>
 </Scene>;
};
