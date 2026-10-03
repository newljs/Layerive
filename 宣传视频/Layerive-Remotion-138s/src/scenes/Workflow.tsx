import {AbsoluteFill, Interactive, interpolate, useCurrentFrame} from 'remotion';
import {Art, Body, Chapter, Pill, Reveal, Shot, ease} from '../visuals';

export const Workflow:React.FC=()=>{
 const f=useCurrentFrame();
 const nodes=[{x:115,y:423,art:'poster-original',label:'生成',v:'V1'},{x:489,y:423,art:'poster-text',label:'改字',v:'V2'},{x:863,y:423,art:'poster-local',label:'局部修改',v:'V3'},{x:1268,y:365,art:'poster-clean',label:'删除元素',v:'V4'},{x:1268,y:655,art:'bus',label:'提取素材',v:'V5'}];
 return <AbsoluteFill>
  <Chapter n="07" label="创作过程，也有价值"/>
  <Reveal style={{position:'absolute',left:90,top:164}}><Interactive.Div name="Version headline" style={{fontSize:87,fontWeight:750,letterSpacing:-3}}>每次尝试，<span style={{color:'#63f3e1'}}>都有迹可循。</span></Interactive.Div><Body style={{marginTop:13}}>版本可回看、可对比，也能从历史版本继续分支。</Body></Reveal>
  <svg width="1920" height="1080" style={{position:'absolute'}}><path d="M365 563 H489 M739 563 H863 M1113 563 H1190 Q1220 563 1220 500 V482 H1268 M1113 563 H1190 Q1220 563 1220 630 V770 H1268" fill="none" stroke="#6374a2" strokeWidth="3" strokeDasharray="12 8" strokeDashoffset={-f} opacity={interpolate(f,[20,60],[0,.8],ease)}/></svg>
  {nodes.map((n,i)=><div key={n.v} style={{position:'absolute',left:n.x,top:n.y,width:250,height:i<3?333:249,border:'1px solid #879ce448',borderRadius:18,background:'#131d30',padding:12,opacity:interpolate(f,[13+i*15,31+i*15],[0,1],ease),translate:`0px ${interpolate(f,[13+i*15,45+i*15],[40,0],ease)}px`}}><div style={{height:i<3?245:163,borderRadius:10,overflow:'hidden'}}><Art name={n.art} fit={n.art==='bus'?'contain':'cover'} style={{objectPosition:'center top',background:'#fff'}}/></div><div style={{display:'flex',gap:17,alignItems:'center',margin:'15px 4px',fontSize:24}}><span style={{fontFamily:'Bahnschrift',color:'#9b88ff'}}>{n.v}</span><span>{n.label}</span></div></div>)}
  <Reveal delay={83} style={{position:'absolute',left:1580,top:397,width:270}}><Shot id={13} style={{width:240,height:132,marginBottom:28}}/><div style={{fontSize:29,fontWeight:650,lineHeight:1.5}}>作品、对话、版本<br/><span style={{color:'#63f3e1'}}>统一归入项目</span></div><div style={{fontSize:23,color:'#8494b5',marginTop:25}}>回到任意一步<br/>继续新的方向</div></Reveal>
  <Reveal delay={113} style={{position:'absolute',left:91,bottom:74,display:'flex',alignItems:'center',gap:25}}><Pill accent>项目保存在本机</Pill><span style={{fontSize:27,color:'#b6c3dc'}}>支持项目导出与完整备份</span><span style={{fontSize:19,color:'#788ba9',marginLeft:22}}>版本关系为功能示意</span></Reveal>
 </AbsoluteFill>;
};
