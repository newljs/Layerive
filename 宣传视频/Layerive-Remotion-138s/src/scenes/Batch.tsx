import {Interactive, interpolate, useCurrentFrame} from 'remotion';
import {Scene} from '../Scene';
import {Art, Body, Chapter, Pill, Reveal, ease} from '../visuals';

export const Batch:React.FC=()=>{
 const f=useCurrentFrame();
 const maps=[['hangzhou','杭州'],['zhengzhou','郑州'],['nanjing','南京']];
 return <Scene>
  <Chapter n="09" label="把重复交给批量"/>
  <Reveal style={{position:'absolute',left:90,top:165}}><Interactive.Div name="Batch headline" style={{fontSize:90,fontWeight:750,letterSpacing:-3}}>模板写一次，<span style={{color:'#63f3e1'}}>批量出一组。</span></Interactive.Div><Body style={{marginTop:12}}>只填不同的变量，省去逐张重复输入。</Body></Reveal>
  <Reveal delay={15} style={{position:'absolute',left:92,top:395,width:536}}>
   <div style={{padding:30,border:'1px solid #9b88ff5a',borderRadius:22,background:'#141a2b'}}><div style={{fontSize:22,color:'#a995ff',marginBottom:18}}>变量模板</div><div style={{fontSize:35,lineHeight:1.75}}>手绘涂鸦风格的<br/><span style={{color:'#d7ccff',background:'#7157fa44',borderRadius:10,padding:'3px 16px'}}>城市</span> 旅行指南海报</div><div style={{height:1,background:'#ffffff1c',margin:'26px 0'}}/>{maps.map(([,label],i)=><div key={label} style={{display:'flex',alignItems:'center',gap:20,marginTop:14,fontSize:27,color: f>48+i*29?'#63f3e1':'#71809c'}}><span style={{fontFamily:'Bahnschrift',fontSize:20}}>0{i+1}</span><span>{label}</span><span style={{marginLeft:'auto'}}>{f>96+i*34?'✓':'·'}</span></div>)}</div>
   <Pill accent style={{marginTop:24}}>支持 2–50 张 / 批次</Pill>
   <div style={{fontSize:22,color:'#8797b4',marginTop:16}}>批量文生图 · 批量改图</div>
  </Reveal>
  {maps.map(([name,label],i)=><div key={name} style={{position:'absolute',left:686+i*391,top:410+(i%2)*31,width:353,height:505,opacity:interpolate(f,[77+i*34,97+i*34],[0,1],ease),translate:`0px ${interpolate(f,[77+i*34,105+i*34],[90,0],ease)}px`,rotate:`${(i-1)*2}deg`}}><div style={{height:445,overflow:'hidden',borderRadius:21,border:'1px solid #ffffff55',boxShadow:'0 24px 70px #0008'}}><Art name={`map-${name}`}/></div><div style={{display:'flex',justifyContent:'space-between',marginTop:18,fontSize:28}}><span>{label}</span><span style={{fontSize:21,color:'#63f3e1'}}>已生成 ✓</span></div></div>)}
  <div style={{position:'absolute',left:689,top:997,fontSize:20,color:'#8291aa'}}>实际演示素材 · 生成过程经剪辑</div>
 </Scene>;
};
