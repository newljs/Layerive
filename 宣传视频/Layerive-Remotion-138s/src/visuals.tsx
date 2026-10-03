import React from 'react';
import {AbsoluteFill, CanvasImage, Easing, Interactive, interpolate, staticFile, useCurrentFrame} from 'remotion';

export const ease = {extrapolateLeft: 'clamp' as const, extrapolateRight: 'clamp' as const, easing: Easing.bezier(.16,1,.3,1)};
export const clamp = {extrapolateLeft: 'clamp' as const, extrapolateRight: 'clamp' as const};
export const colors = {ink: '#080c18', cyan: '#63f3e1', purple: '#9b88ff', white: '#f8f9ff', muted: '#a8b3cc'};

export const Backdrop: React.FC = () => {
 const f=useCurrentFrame();
 return <AbsoluteFill style={{backgroundColor:'#080c18',overflow:'hidden'}}>
  <AbsoluteFill style={{background:'radial-gradient(ellipse at 83% 24%, #262345 0%, transparent 48%), radial-gradient(ellipse at 17% 90%, #0e2934 0%, transparent 53%)'}} />
  <AbsoluteFill style={{opacity:.13,backgroundImage:'linear-gradient(#7182bb40 1px, transparent 1px), linear-gradient(90deg, #7182bb40 1px, transparent 1px)',backgroundSize:'96px 96px',translate:`0px ${f*.045%96}px`}} />
  <svg width="1920" height="1080" style={{position:'absolute',opacity:.4}}>
   {[0,1,2].map(i=><ellipse key={i} cx={1490} cy={460} rx={520+i*115} ry={285+i*65} fill="none" stroke={i===1?'#617bb64d':'#6c9ab427'} strokeWidth="1" transform={`rotate(${-23+f*.007+i*8} 1490 460)`}/>)}
   {Array.from({length:24},(_,i)=><circle key={i} cx={(i*173+f*(.1+(i%3)*.07))%1920} cy={(i*113+79)%1080} r={i%4===0?2:1} fill={i%3===0?'#63f3e1':'#9b88ff'} opacity={.2+Math.sin(f*.018+i)*.15} />)}
  </svg>
 </AbsoluteFill>;
};

export const Brand:React.FC=()=> <div style={{position:'absolute',left:88,top:44,display:'flex',alignItems:'center',gap:14}}>
 <CanvasImage src={staticFile('layerive-logo.png')} style={{width:50,height:50,borderRadius:14}}/>
 <span style={{fontSize:34,fontWeight:750,letterSpacing:-1}}>Layerive</span>
 <span style={{height:23,width:1,background:'#ffffff25',marginLeft:14,marginRight:12}}/>
 <span style={{fontSize:21,color:'#a8b3cc',letterSpacing:2}}>开源 AI 图片创作工作台</span>
</div>;

export const Chapter:React.FC<{n:string;label:string}> = ({n,label})=> <div style={{position:'absolute',top:54,right:88,display:'flex',gap:18,alignItems:'center',color:'#adb7d0',fontSize:20,letterSpacing:2}}><span style={{color:'#63f3e1',fontFamily:'Bahnschrift, sans-serif'}}>{n}</span><span>{label}</span></div>;

export const Reveal:React.FC<{children:React.ReactNode;delay?:number;style?:React.CSSProperties;name?:string}> = ({children,delay=0,style,name='Animated content'})=> {
 const f=useCurrentFrame();
 return <Interactive.Div name={name} style={{...style,opacity:interpolate(f,[delay,delay+19],[0,1],ease),translate:`0px ${interpolate(f,[delay,delay+28],[36,0],ease)}px`}}>{children}</Interactive.Div>;
};

export const Eyebrow:React.FC<{children:React.ReactNode}> = ({children})=><div style={{fontSize:23,letterSpacing:4,color:'#63f3e1',fontWeight:600,marginBottom:24}}>{children}</div>;
export const Body:React.FC<{children:React.ReactNode;style?:React.CSSProperties}> = ({children,style})=><div style={{fontSize:33,lineHeight:1.65,color:'#a8b3cc',...style}}>{children}</div>;
export const Pill:React.FC<{children:React.ReactNode;accent?:boolean;style?:React.CSSProperties}> = ({children,accent=false,style})=><div style={{display:'inline-flex',alignItems:'center',justifyContent:'center',border:`1px solid ${accent?'#63f3e15c':'#ffffff25'}`,background:accent?'#143031':'#141b2b',color:accent?'#7cf6e7':'#c7cee1',padding:'13px 22px',borderRadius:99,fontSize:25,fontWeight:600,...style}}>{children}</div>;
export const Arrow:React.FC<{style?:React.CSSProperties}> = ({style})=><div style={{fontSize:52,color:'#63f3e1',...style}}>→</div>;

export const Art:React.FC<{name:string;style?:React.CSSProperties;fit?:'cover'|'contain'}>=({name,style,fit='cover'})=><CanvasImage src={staticFile(`art/${name}.jpg`)} style={{width:'100%',height:'100%',objectFit:fit,...style}}/>;
export const Shot:React.FC<{id:number;style?:React.CSSProperties}> = ({id,style})=> <div style={{borderRadius:22,overflow:'hidden',border:'1px solid #ffffff36',boxShadow:'0 35px 100px #0008',background:'#eff0f4',...style}}><CanvasImage src={staticFile(`shots/shot-${id}.jpg`)} style={{width:'100%',height:'100%',objectFit:'cover'}}/></div>;
export const Footnote:React.FC<{children:React.ReactNode}> = ({children})=><div style={{position:'absolute',left:90,bottom:58,fontSize:22,color:'#8492af',letterSpacing:1}}>{children}</div>;

export const Cursor:React.FC<{x:number;y:number;click?:boolean}> = ({x,y,click})=><div style={{position:'absolute',left:x,top:y,width:40,height:50,filter:'drop-shadow(0 2px 8px #0008)'}}><svg viewBox="0 0 40 50" width="40" height="50"><path d="M4 3 L6 38 L16 28 L26 45 L33 41 L23 25 L38 23 Z" fill="#fff" stroke="#6d51ff" strokeWidth="2"/></svg>{click?<div style={{position:'absolute',width:80,height:80,border:'2px solid #63f3e1',borderRadius:'50%',left:-40,top:-40}}/>:null}</div>;
