import {Interactive, interpolate, useCurrentFrame} from 'remotion';
import {Scene} from '../Scene';
import {Art, Body, Chapter, Cursor, Reveal, clamp, ease} from '../visuals';

export const TextEdit: React.FC = () => {
 const f=useCurrentFrame();
 return <Scene>
  <Chapter n="05" label="文字修改 · 直接填新文案"/>
  <Reveal style={{position:'absolute',left:90,top:170}}><Interactive.Div name="Text edit headline" style={{fontSize:89,fontWeight:750}}>改文字，<span style={{color:'#63f3e1'}}>直接填新的内容。</span></Interactive.Div><Body style={{marginTop:20,fontSize:36}}>编辑文字 → 修改识别结果 → 提交改图</Body></Reveal>
  <div style={{position:'absolute',left:90,top:410,width:839}}><div style={{fontSize:30,color:'#bac5d9',marginBottom:24}}>修改前</div><div style={{height:351,borderRadius:23,overflow:'hidden',border:'2px solid #ffffff44'}}><Art name="title-before"/></div></div>
  <Interactive.Div name="Recognized text form" style={{position:'absolute',left:987,top:410,width:839,opacity:interpolate(f,[64,88],[0,1],ease)}}>
   <div style={{fontSize:30,color:'#63f3e1',marginBottom:24}}>{f<282?'直接修改识别到的文字':'修改后'}</div>
   <div style={{height:351,borderRadius:23,overflow:'hidden',background:'#f6f6fa',border:'2px solid #63f3e177',position:'relative'}}>
    <Art name="text-form"/>
    <div style={{position:'absolute',left:25,top:189,width:785,height:79,border:'3px solid #967bff',borderRadius:9,opacity:interpolate(f,[119,141,230,248],[0,1,1,0],clamp)}}/>
    <div style={{position:'absolute',inset:0,opacity:interpolate(f,[280,300],[0,1],ease)}}><Art name="title-after"/></div>
   </div>
  </Interactive.Div>
  <Interactive.Div name="Submit edited text" style={{position:'absolute',left:1500,top:852,padding:'20px 27px',borderRadius:17,background:f>251?'#143031':'#7956fa',border:'1px solid #a8a1ff80',fontSize:31,color:f>251?'#7cf6e7':'#fff',opacity:interpolate(f,[175,197],[0,1],ease)}}>{f>=298?'已生成新版本 ✓':f>=251?'正在生成…':'提交并改图'}</Interactive.Div>
  <div style={{opacity:interpolate(f,[105,123,251,265],[0,1,1,0],clamp)}}><Cursor x={interpolate(f,[120,177,239],[1503,1503,1668],ease)} y={interpolate(f,[120,177,239],[650,650,891],ease)} click={f>=239&&f<251}/></div>
  <Reveal delay={305} style={{position:'absolute',left:95,top:867,fontSize:34,color:'#c9d4e7'}}>不用再解释哪行字、在哪里、换成什么。</Reveal>
  <div style={{position:'absolute',left:95,top:982,fontSize:21,color:'#8091ac'}}>真实表单与结果 · 生成等待经剪辑</div>
 </Scene>;
};
