import {Interactive, interpolate, useCurrentFrame} from 'remotion';
import {Scene} from '../Scene';
import {Chapter, Pill, Reveal, Shot, ease} from '../visuals';

export const Intro: React.FC = () => {
 const f=useCurrentFrame();
 return <Scene>
  <Chapter n="02" label="Layerive · 用操作表达意图"/>
  <Reveal style={{position:'absolute',left:90,top:180,width:690}}>
   <Interactive.Div name="Product introduction" style={{fontSize:91,fontWeight:750,lineHeight:1.3}}>让意图，<br/><span style={{color:'#63f3e1'}}>变成直接操作。</span></Interactive.Div>
   <div style={{fontSize:35,color:'#bac5dc',lineHeight:1.7,marginTop:25}}>你指出目标，<br/>Layerive 理解并组织编辑指令。</div>
  </Reveal>
  <Reveal delay={35} style={{position:'absolute',left:800,top:205,width:1020}}><Shot id={1} style={{width:1020,height:536}}/></Reveal>
  <Interactive.Div name="Choose a tool" style={{position:'absolute',left:97,top:617,fontSize:43,color:'#f1eeff',opacity:interpolate(f,[46,66],[0,1],ease)}}><span style={{color:'#ad99ff'}}>选</span> 一个功能</Interactive.Div>
  <Interactive.Div name="Circle the target" style={{position:'absolute',left:97,top:699,fontSize:43,color:'#f1eeff',opacity:interpolate(f,[103,123],[0,1],ease)}}><span style={{color:'#63f3e1'}}>圈</span> 出修改目标</Interactive.Div>
  <Interactive.Div name="Text or reference" style={{position:'absolute',left:97,top:781,fontSize:43,color:'#f1eeff',opacity:interpolate(f,[158,178],[0,1],ease)}}>填新文字，或给参考图</Interactive.Div>
  <Reveal delay={203} style={{position:'absolute',left:800,top:800,display:'flex',flexWrap:'wrap',gap:16,width:1015}}><Pill accent>删除元素</Pill><Pill>文字修改</Pill><Pill>素材提取</Pill><Pill>局部修改</Pill><Pill>融合换装</Pill></Reveal>
  <Reveal delay={237} style={{position:'absolute',left:800,top:945,fontSize:32,color:'#63f3e1'}}>少写提示词，把精力留给创意。</Reveal>
 </Scene>;
};
