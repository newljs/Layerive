import {Interactive, interpolate, useCurrentFrame} from 'remotion';
import {Scene} from '../Scene';
import {Art, Body, Chapter, Cursor, Pill, Reveal, clamp, ease} from '../visuals';

export const HatRemoval: React.FC = () => {
 const f=useCurrentFrame();
 return <Scene>
  <Chapter n="04" label="删除元素 · 人物配件"/>
  <Reveal style={{position:'absolute',left:90,top:196,width:630}}>
   <Interactive.Div name="Hat removal title" style={{fontSize:87,fontWeight:750,lineHeight:1.3}}>人物配件，<br/><span style={{color:'#63f3e1'}}>也能圈选删除。</span></Interactive.Div>
   <Body style={{fontSize:35,marginTop:30}}>圈出帽子，发起删除。<br/>目标位置，直接用操作表达。</Body>
   <div style={{marginTop:38}}><Pill accent>无需手写删除提示词</Pill></div>
  </Reveal>
  <div style={{position:'absolute',left:740,top:225,width:418,height:754,borderRadius:23,overflow:'hidden',border:'2px solid #ffffff44',boxShadow:'0 25px 70px #0008'}}>
   <Art name="hat-before"/>
   <div style={{position:'absolute',inset:0,opacity:interpolate(f,[169,188],[0,1],ease)}}><Art name="hat-after"/></div>
   <div style={{position:'absolute',left:137,top:7,width:interpolate(f,[56,98],[0,146],clamp),height:interpolate(f,[56,98],[0,103],clamp),border:'3px solid #bba7ff',borderRadius:6,opacity:interpolate(f,[50,56,160,176],[0,1,1,0],clamp)}}/>
   <div style={{position:'absolute',left:18,bottom:20}}><Pill accent>{f<105?'圈选帽子':f<176?'正在处理':'删除后的完整人物'}</Pill></div>
  </div>
  <div style={{position:'absolute',left:1210,top:246,width:615,opacity:interpolate(f,[65,88],[0,1],ease)}}>
    <div style={{fontSize:30,color:'#aebbd2',marginBottom:19}}>头部细节</div>
    <div style={{height:557,borderRadius:23,overflow:'hidden',border:'2px solid #bba7ff66',position:'relative'}}>
     <Art name="hat-head-before" fit="contain" style={{background:'#fff'}}/>
     <div style={{position:'absolute',inset:0,opacity:interpolate(f,[169,188],[0,1],ease)}}><Art name="hat-head-after" fit="contain" style={{background:'#fff'}}/></div>
    </div>
    <div style={{fontSize:31,color:'#63f3e1',marginTop:25}}>{f<169?'看清目标，再圈选':'帽子已移除'}</div>
  </div>
  <Interactive.Div name="Hat result comparison" style={{position:'absolute',left:1190,top:217,width:664,height:720,background:'#0b1323',opacity:interpolate(f,[226,240],[0,1],ease)}}>
   <div style={{position:'absolute',left:0,top:39,width:322}}><div style={{fontSize:30,color:'#bbc6db',marginBottom:24}}>修改前</div><div style={{height:467,borderRadius:20,overflow:'hidden'}}><Art name="hat-head-before" fit="contain" style={{background:'#fff'}}/></div></div>
   <div style={{position:'absolute',left:342,top:39,width:322}}><div style={{fontSize:30,color:'#63f3e1',marginBottom:24}}>修改后</div><div style={{height:467,borderRadius:20,overflow:'hidden',border:'2px solid #63f3e177'}}><Art name="hat-head-after" fit="contain" style={{background:'#fff'}}/></div></div>
   <div style={{position:'absolute',left:0,top:614,fontSize:31,color:'#63f3e1'}}>同样的圈选，处理更细的目标。</div>
  </Interactive.Div>
  <div style={{opacity:interpolate(f,[41,54,104,120],[0,1,1,0],clamp)}}><Cursor x={interpolate(f,[56,98],[877,1023],clamp)} y={interpolate(f,[56,98],[232,335],clamp)}/></div>
  <div style={{position:'absolute',left:92,top:975,fontSize:21,color:'#7d8eaa'}}>真实截图演示 · 生成等待经剪辑</div>
 </Scene>;
};
