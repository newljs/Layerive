import {AbsoluteFill, staticFile, useCurrentFrame} from 'remotion';
import {Audio} from '@remotion/media';
import {TransitionSeries, linearTiming} from '@remotion/transitions';
import {fade} from '@remotion/transitions/fade';
import {Pain} from './scenes/Pain';
import {Intro} from './scenes/Intro';
import {Precise} from './scenes/Precise';
import {HatRemoval} from './scenes/HatRemoval';
import {TextEdit} from './scenes/TextEdit';
import {Extract} from './scenes/Extract';
import {Reference} from './scenes/Reference';
import {Fusion} from './scenes/Fusion';
import {Batch} from './scenes/Batch';
import {Freedom} from './scenes/Freedom';
import {Outro} from './scenes/Outro';
export const LayerivePromo:React.FC=()=>{
 const f=useCurrentFrame();
 return <AbsoluteFill style={{background:'#080c18'}}>
  <Audio name="Original electronic soundtrack" src={staticFile('music-master.wav')} volume={1}/>
  <TransitionSeries>
   <TransitionSeries.Sequence name="01 提示词与反复尝试" durationInFrames={552}><Pain/></TransitionSeries.Sequence>
   <TransitionSeries.Transition presentation={fade()} timing={linearTiming({durationInFrames:12})}/>
   <TransitionSeries.Sequence name="02 用操作表达意图" durationInFrames={312}><Intro/></TransitionSeries.Sequence>
   <TransitionSeries.Transition presentation={fade()} timing={linearTiming({durationInFrames:12})}/>
   <TransitionSeries.Sequence name="03 删除海报船只" durationInFrames={372}><Precise/></TransitionSeries.Sequence>
   <TransitionSeries.Transition presentation={fade()} timing={linearTiming({durationInFrames:12})}/>
   <TransitionSeries.Sequence name="04 删除人物帽子" durationInFrames={372}><HatRemoval/></TransitionSeries.Sequence>
   <TransitionSeries.Transition presentation={fade()} timing={linearTiming({durationInFrames:12})}/>
   <TransitionSeries.Sequence name="05 直接编辑文字" durationInFrames={432}><TextEdit/></TransitionSeries.Sequence>
   <TransitionSeries.Transition presentation={fade()} timing={linearTiming({durationInFrames:12})}/>
   <TransitionSeries.Sequence name="06 提取公交车素材" durationInFrames={372}><Extract/></TransitionSeries.Sequence>
   <TransitionSeries.Transition presentation={fade()} timing={linearTiming({durationInFrames:12})}/>
   <TransitionSeries.Sequence name="07 参考图局部替换" durationInFrames={432}><Reference/></TransitionSeries.Sequence>
   <TransitionSeries.Transition presentation={fade()} timing={linearTiming({durationInFrames:12})}/>
   <TransitionSeries.Sequence name="08 参考图融合与换装" durationInFrames={552}><Fusion/></TransitionSeries.Sequence>
   <TransitionSeries.Transition presentation={fade()} timing={linearTiming({durationInFrames:12})}/>
   <TransitionSeries.Sequence name="09 变量批量制作" durationInFrames={252}><Batch/></TransitionSeries.Sequence>
   <TransitionSeries.Transition presentation={fade()} timing={linearTiming({durationInFrames:12})}/>
   <TransitionSeries.Sequence name="10 开源与模型自主接入" durationInFrames={372}><Freedom/></TransitionSeries.Sequence>
   <TransitionSeries.Transition presentation={fade()} timing={linearTiming({durationInFrames:12})}/>
   <TransitionSeries.Sequence name="11 品牌与项目地址" durationInFrames={240}><Outro/></TransitionSeries.Sequence>
  </TransitionSeries>
  <div style={{position:'absolute',left:0,bottom:0,width:`${f/4139*100}%`,height:3,background:'linear-gradient(90deg,#8362ff,#63f3e1)'}}/>
 </AbsoluteFill>;
};
