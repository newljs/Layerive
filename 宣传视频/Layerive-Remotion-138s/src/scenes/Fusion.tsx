import {Interactive, interpolate, useCurrentFrame} from 'remotion';
import {Scene} from '../Scene';
import {Art, Body, Chapter, Cursor, Eyebrow, Pill, Reveal, clamp, ease} from '../visuals';

export const Fusion:React.FC=()=>{
 const f=useCurrentFrame();
 const x=interpolate(f,[170,285],[130,998],ease);
 const y=interpolate(f,[170,285],[700,533],ease);
 return <Scene>
  <Chapter n="08" label="参考图融合 · 人物换装"/>
  <Reveal style={{position:'absolute',left:90,top:205,width:695}}><Eyebrow>复杂服装细节，用图片表达</Eyebrow><Interactive.Div name="Drag to change outfit" style={{fontSize:91,lineHeight:1.22,fontWeight:750,letterSpacing:-3}}>把参考图，<br/><span style={{color:'#63f3e1'}}>融入主图。</span></Interactive.Div><Body style={{marginTop:29,fontSize:34}}>人物换装，用图片表达服装细节。<br/>把参考图拖到主图上的目标位置。</Body><div style={{display:'flex',gap:12,marginTop:33}}><Pill>基础融合</Pill><Pill accent>换装</Pill><Pill>动作迁移</Pill><Pill>合影</Pill></div></Reveal>
  <div style={{position:'absolute',left:824,top:218,width:415,height:702,border:'1px solid #ffffff44',borderRadius:25,overflow:'hidden',boxShadow:'0 25px 80px #0007'}}><Art name="person-costume"/><div style={{position:'absolute',left:18,top:18,background:'#080c18dd',padding:'10px 19px',borderRadius:10,fontSize:24}}>主图</div></div>
  <div style={{position:'absolute',left:1320,top:218,width:415,height:702,border:'2px solid #63f3e188',borderRadius:25,overflow:'hidden',boxShadow:'0 25px 80px #0007',opacity:interpolate(f,[363,395],[0,1],ease),translate:`${interpolate(f,[363,402],[75,0],ease)}px 0px`}}><Art name="person-suit"/><div style={{position:'absolute',left:18,top:18,background:'#14352fee',padding:'10px 19px',borderRadius:10,fontSize:24,color:'#8cffe9'}}>换装结果</div></div>
  <div style={{position:'absolute',left:1235,top:538,width:95,height:95,borderRadius:100,background:'#7457fa',display:'flex',alignItems:'center',justifyContent:'center',fontSize:44,border:'8px solid #0c1425',boxShadow:'0 0 40px #7457fa55',opacity:interpolate(f,[330,353],[0,1],ease)}}>→</div>
  <div style={{position:'absolute',left:92,top:717,width:190,height:180,borderRadius:18,overflow:'hidden',border:'2px solid #ac98ff',opacity:interpolate(f,[84,111],[0,1],ease)}}><Art name="suit-reference"/></div><div style={{position:'absolute',left:313,top:767,fontSize:29,color:'#aabbd5'}}>服装参考图<br/><span style={{color:'#63f3e1'}}>拖到人物身上 →</span></div>
  <div style={{position:'absolute',left:x,top:y,width:146,height:155,borderRadius:18,overflow:'hidden',border:'3px solid #b9a5ff',boxShadow:'0 15px 50px #0008',opacity:interpolate(f,[163,176,288,318],[0,1,1,0],clamp)}}><Art name="suit-reference"/></div>
  <div style={{opacity:interpolate(f,[144,164,289,318],[0,1,1,0],clamp)}}><Cursor x={x+95} y={y+111} click={f>=285&&f<301}/></div>
  <Reveal delay={417} style={{position:'absolute',left:832,top:960,fontSize:27,color:'#aabbd5'}}>用参考图表达造型，用落点指定目标。</Reveal>
 </Scene>;
};
