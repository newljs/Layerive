import {AbsoluteFill, Interactive, interpolate, useCurrentFrame} from 'remotion';
import {Body, Chapter, Cursor, Reveal, ease} from '../visuals';

export const Create:React.FC=()=>{
 const f=useCurrentFrame();
 const cards=[['圈','删除元素','圈出不想要的对象'],['点','编辑文字','直接填写新的文案'],['选','替换内容','选中区域，附上参考'],['拖','人物换装','拖入服装参考图']];
 return <AbsoluteFill>
  <Chapter n="01" label="交互代替反复描述"/>
  <Reveal style={{position:'absolute',left:90,top:161}}><Interactive.Div name="Direct interaction promise" style={{fontSize:88,fontWeight:750,letterSpacing:-3}}>复杂改图，<span style={{color:'#63f3e1'}}>变成直观操作。</span></Interactive.Div><Body style={{marginTop:15}}>用交互表达意图，减少反复编写和调试提示词。</Body></Reveal>
  {cards.map(([verb,title,desc],i)=><div key={verb} style={{position:'absolute',left:90+i*441,top:400,width:416,height:425,padding:33,borderRadius:26,background:i===Math.floor(f/30)%4?'#162d35':'#141d30',border:`1px solid ${i===Math.floor(f/30)%4?'#63f3e1aa':'#9b88ff45'}`,opacity:interpolate(f,[9+i*11,24+i*11],[0,1],ease),translate:`0px ${interpolate(f,[9+i*11,35+i*11],[45,0],ease)}px`}}>
   <div style={{width:127,height:127,border:'2px solid #63f3e16a',borderRadius:i===0?16:32,display:'flex',alignItems:'center',justifyContent:'center',fontSize:79,color:'#63f3e1',fontWeight:650,background:'#63f3e109',marginBottom:36}}>{verb}</div>
   <div style={{fontSize:38,fontWeight:650,marginBottom:24}}>{title}</div><div style={{fontSize:27,color:'#aebbd5'}}>{desc}</div>
  </div>)}
  <div style={{opacity:interpolate(f,[36,51],[0,1],ease)}}><Cursor x={interpolate(f,[36,70,99,129],[395,838,1278,1710],ease)} y={790}/></div>
  <Reveal delay={65} style={{position:'absolute',left:91,top:917,fontSize:35,color:'#dbe4f5'}}>你负责选择，<span style={{color:'#63f3e1'}}>AI 负责理解与执行。</span></Reveal>
 </AbsoluteFill>;
};
