import {Interactive, interpolate, useCurrentFrame} from 'remotion';
import {Scene} from '../Scene';
import {Art, Body, Chapter, Cursor, Eyebrow, Pill, Reveal, clamp, ease} from '../visuals';

export const Reference:React.FC=()=>{
 const f=useCurrentFrame();
 const selection=interpolate(f,[62,119],[0,1],clamp);
 return <Scene>
  <Chapter n="07" label="选 → 参考图换内容"/>
  <Reveal style={{position:'absolute',left:90,top:202,width:670}}><Eyebrow>位置用圈选，内容用参考</Eyebrow><Interactive.Div name="Replace from reference" style={{fontSize:88,lineHeight:1.23,fontWeight:750,letterSpacing:-3}}>圈一个区域，<br/><span style={{color:'#63f3e1'}}>选一张参考。</span></Interactive.Div><Body style={{marginTop:31,fontSize:34}}>想换什么，直接给图。<br/>不用把主体和位置写成一大段提示词。</Body></Reveal>
  <Reveal delay={143} style={{position:'absolute',left:91,top:629,display:'flex',gap:26,alignItems:'center'}}><div style={{width:163,height:163,borderRadius:19,overflow:'hidden',border:'3px solid #ac9aff'}}><Art name="reference-face"/></div><div><div style={{fontSize:25,color:'#aebbd5',marginBottom:15}}>已选择参考图</div><div style={{fontSize:27,background:'#7956fa',padding:'19px 23px',borderRadius:14}}>智能替换并融合</div></div></Reveal>
  <Reveal delay={243} style={{position:'absolute',left:91,top:865}}><Pill accent>附参考图时，补充要求可留空</Pill></Reveal>
  {[['reference-before','圈选区域'],['reference-after','替换结果']].map(([name,label],i)=><div key={name} style={{position:'absolute',left:811+i*512,top:244,width:468,height:655,borderRadius:24,overflow:'hidden',border:`2px solid ${i===0?'#ffffff45':'#63f3e175'}`,boxShadow:'0 28px 80px #0008',opacity:i===0?1:interpolate(f,[269,294],[0,1],ease),translate:i===0?'0px 0px':`${interpolate(f,[269,302],[48,0],ease)}px 0px`}}>
   <Art name={name}/><div style={{position:'absolute',left:15,top:15,background:i===0?'#080c18df':'#143031',padding:'10px 16px',borderRadius:11,fontSize:23,color:i===0?'#fff':'#7cf6e7'}}>{label}</div>
   {i===0?<div style={{position:'absolute',left:157,top:38,width:selection*150,height:selection*176,border:'3px solid #b89dff',borderRadius:6,opacity:interpolate(f,[45,58,250,278],[0,1,1,0],clamp)}}/>:null}
  </div>)}
  <div style={{opacity:interpolate(f,[45,58,246,269],[0,1,1,0],clamp)}}><Cursor x={interpolate(f,[62,119,188,231],[968,1118,165,480],clamp)} y={interpolate(f,[62,119,188,231],[282,458,716,748],clamp)} click={f>=231&&f<245}/></div>
  <Reveal delay={311} style={{position:'absolute',left:820,top:939,fontSize:28,color:'#aab9d0'}}>从参考主体，到选定位置，自动规划替换与融合。</Reveal>
 </Scene>;
};
