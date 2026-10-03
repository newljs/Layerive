import {Interactive, interpolate, useCurrentFrame} from 'remotion';
import {Scene} from '../Scene';
import {Art, Chapter, Reveal, clamp, ease} from '../visuals';

export const Pain: React.FC = () => {
  const f=useCurrentFrame();
  return <Scene>
    <Chapter n="01" label="从一个改图需求开始"/>
    <Reveal style={{position:'absolute',left:90,top:156}}>
      <Interactive.Div name="Pain headline" style={{fontSize:86,fontWeight:750,lineHeight:1.28}}>改一张图，<span style={{color:'#b8a5ff'}}>要先写清楚这么多？</span></Interactive.Div>
      <div style={{fontSize:36,color:'#a8b3cc',marginTop:20}}>目标在哪、改成什么、哪些地方要保留……</div>
    </Reveal>
    <div style={{position:'absolute',left:100,top:370,width:470,height:580,borderRadius:24,overflow:'hidden',border:'1px solid #ffffff40',boxShadow:'0 25px 70px #0008'}}><Art name={f<371?"poster-local":"poster-original"} fit="contain" style={{background:'#101829'}}/></div>
    <Interactive.Div name="Detailed removal request" style={{position:'absolute',left:635,top:370,width:1195,padding:'28px 34px',borderRadius:24,background:'#202239',border:'1px solid #a394ee55',opacity:interpolate(f,[24,48,352,372],[0,1,1,0],clamp)}}>
      <div style={{fontSize:26,color:'#b8a5ff',marginBottom:18}}>删除一艘船，需要说明</div>
      <div style={{fontSize:37,lineHeight:1.7}}>删除<span style={{color:'#e1d7ff'}}>河面中央的白色游船</span>，<br/>保留大桥、岸边建筑和其他元素，<br/>补全水面，保持原有画风、颜色和构图。</div>
    </Interactive.Div>
    <Interactive.Div name="Revision one" style={{position:'absolute',left:705,top:695,width:1125,padding:'23px 30px',fontSize:34,borderRadius:18,background:'#28243b',border:'1px solid #a394ee44',opacity:interpolate(f,[178,200,352,372],[0,1,1,0],clamp)}}>只删除这艘船，其他区域保持不变。</Interactive.Div>
    <Interactive.Div name="Revision two" style={{position:'absolute',left:755,top:800,width:1075,padding:'23px 30px',fontSize:34,borderRadius:18,background:'#28243b',border:'1px solid #a394ee44',opacity:interpolate(f,[264,286,352,372],[0,1,1,0],clamp)}}>修复的位置，需要与周围水面自然衔接。</Interactive.Div>
    <Interactive.Div name="Text editing request" style={{position:'absolute',left:635,top:382,width:1195,padding:36,borderRadius:24,background:'#202239',border:'1px solid #a394ee55',opacity:interpolate(f,[371,393],[0,1],ease)}}>
      <div style={{fontSize:28,color:'#b8a5ff',marginBottom:24}}>换一句标题，也要解释原文、位置和新内容</div>
      <div style={{fontSize:39,lineHeight:1.8}}>将海报上方的“十一上海”<br/>改成“国庆上海”，<br/>保持字体风格、颜色和排版，<br/>下方“旅行指南”不变。</div>
    </Interactive.Div>
    <Interactive.Div name="Repeated attempts takeaway" style={{position:'absolute',left:640,top:955,fontSize:33,color:'#d6cafa',opacity:interpolate(f,[295,318],[0,1],ease)}}>结果不合适，还得继续补充、反复尝试。</Interactive.Div>
    <div style={{position:'absolute',left:100,top:986,fontSize:19,color:'#73829e'}}>对话需求示意</div>
  </Scene>;
};
