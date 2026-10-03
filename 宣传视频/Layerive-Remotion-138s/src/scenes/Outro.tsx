import {CanvasImage, Interactive, interpolate, staticFile, useCurrentFrame} from 'remotion';
import {Scene} from '../Scene';
import {Pill, Reveal, ease} from '../visuals';

export const Outro:React.FC=()=>{
 const f=useCurrentFrame();
 return <Scene brand={false}>
  <div style={{position:'absolute',left:790,top:88,width:340,height:340,border:'1px solid #9b88ff40',borderRadius:'50%',scale:interpolate(f,[0,100],[.8,1.15],ease),opacity:interpolate(f,[0,32],[0,1],ease)}}/>
  <Reveal style={{position:'absolute',left:0,width:1920,top:148,display:'flex',flexDirection:'column',alignItems:'center'}}><CanvasImage src={staticFile('layerive-logo.png')} style={{width:112,height:112,borderRadius:30,boxShadow:'0 0 80px #8461ff50'}}/><Interactive.Div name="Closing brand" style={{fontSize:80,fontWeight:750,letterSpacing:-3,marginTop:19}}>Layerive</Interactive.Div></Reveal>
  <Reveal delay={9} style={{position:'absolute',left:0,width:1920,top:405,textAlign:'center'}}><Interactive.Div name="Main takeaway" style={{fontSize:87,fontWeight:750,letterSpacing:-3}}>少写提示词，<span style={{color:'#63f3e1'}}>让改图更简单。</span></Interactive.Div><div style={{fontSize:35,color:'#b7c2db',marginTop:25}}>把精力留给创意，少花在反复调试提示词上。</div></Reveal>
  <Reveal delay={20} style={{position:'absolute',left:0,width:1920,justifyContent:'center',top:643,display:'flex',gap:28}}><Pill accent style={{fontSize:31,padding:'17px 29px'}}>开源项目</Pill><Pill accent style={{fontSize:31,padding:'17px 29px'}}>本地部署</Pill><Pill accent style={{fontSize:31,padding:'17px 29px'}}>模型自主接入</Pill></Reveal>
  <Reveal delay={32} style={{position:'absolute',left:0,width:1920,top:797,textAlign:'center'}}><div style={{fontSize:34,color:'#d9deef',letterSpacing:1}}>github.com/newljs/Layerive</div><div style={{fontSize:25,color:'#91a1bb',marginTop:21}}>开源 AI 图片创作工作台 · 接入兼容接口的模型服务</div></Reveal>
 </Scene>;
};
