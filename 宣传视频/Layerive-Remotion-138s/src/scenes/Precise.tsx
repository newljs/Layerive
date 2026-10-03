import {Interactive, interpolate, useCurrentFrame} from 'remotion';
import {Scene} from '../Scene';
import {Art, Body, Chapter, Cursor, Eyebrow, Pill, Reveal, clamp, ease} from '../visuals';

export const Precise:React.FC=()=>{
 const f=useCurrentFrame();
 const p=interpolate(f,[194,231],[0,100],ease);
 const selection=interpolate(f,[81,135],[0,1],clamp);
 return <Scene>
  <Chapter n="03" label="圈 → 删除元素"/>
  <Reveal style={{position:'absolute',left:90,top:222,width:665}}>
   <Eyebrow>不用再解释目标在哪</Eyebrow>
   <Interactive.Div name="Circle to remove" style={{fontSize:84,lineHeight:1.22,fontWeight:750,letterSpacing:-3}}>圈住它，<br/><span style={{color:'#63f3e1'}}>就能发起删除。</span></Interactive.Div>
   <Body style={{marginTop:31,fontSize:34}}>选中「删除元素」，圈出船只。<br/>自动识别目标，补全被遮挡的背景。</Body>
   <div style={{marginTop:35,width:340,padding:'19px 24px',borderRadius:15,border:'1px solid #bba7ff',background:f<57?'#171e30':'#7855ed',fontSize:34,fontWeight:600}}>⌖　删除元素</div>
   <Pill accent style={{marginTop:32}}>无需手写删除提示词</Pill>
  </Reveal>
  <div style={{position:'absolute',left:812,top:257,width:1004,height:645,borderRadius:25,overflow:'hidden',border:'2px solid #8ba7c853',boxShadow:'0 32px 100px #0009'}}>
   <Art name="detail-food"/><div style={{position:'absolute',inset:0,clipPath:`inset(0 ${100-p}% 0 0)`}}><Art name="detail-clean"/></div>
   <div style={{position:'absolute',left:`${p}%`,top:0,bottom:0,width:3,background:'#63f3e1',opacity:p<99&&p>0?1:0,boxShadow:'0 0 25px #63f3e1'}}/>
   <div style={{position:'absolute',left:253,top:174,width:selection*308,height:selection*170,border:'3px solid #bba7ff',borderRadius:9,opacity:interpolate(f,[70,80,165,192],[0,1,1,0],clamp),boxShadow:'0 0 0 1500px #080c182c'}}/>
   <div style={{position:'absolute',right:18,top:18}}><Pill accent>{p>99?'删除完成':f>155?'AI 自动处理':'圈选船只'}</Pill></div>
  </div>
  <div style={{opacity:interpolate(f,[24,36,151,177],[0,1,1,0],clamp)}}><Cursor x={interpolate(f,[32,58,81,135],[344,344,1065,1373],clamp)} y={interpolate(f,[32,58,81,135],[690,690,431,601],clamp)} click={f>=56&&f<67}/></div>
  <Reveal delay={243} style={{position:'absolute',left:819,top:940,fontSize:29,color:'#b5c5dd'}}>圈选，比一遍遍描述位置更直接。</Reveal>
 </Scene>;
};
