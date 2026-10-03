import './index.css';
import {Composition, Folder} from 'remotion';
import {LayerivePromo} from './LayerivePromo';
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
export const RemotionRoot:React.FC=()=> <>
 <Composition id="LayerivePromo" component={LayerivePromo} durationInFrames={4140} fps={30} width={1920} height={1080}/>
 <Folder name="Scenes">
   <Composition id="Pain" component={Pain} durationInFrames={552} fps={30} width={1920} height={1080}/>
   <Composition id="Intro" component={Intro} durationInFrames={312} fps={30} width={1920} height={1080}/>
   <Composition id="Precise" component={Precise} durationInFrames={372} fps={30} width={1920} height={1080}/>
   <Composition id="HatRemoval" component={HatRemoval} durationInFrames={372} fps={30} width={1920} height={1080}/>
   <Composition id="TextEdit" component={TextEdit} durationInFrames={432} fps={30} width={1920} height={1080}/>
   <Composition id="Extract" component={Extract} durationInFrames={372} fps={30} width={1920} height={1080}/>
   <Composition id="Reference" component={Reference} durationInFrames={432} fps={30} width={1920} height={1080}/>
   <Composition id="Fusion" component={Fusion} durationInFrames={552} fps={30} width={1920} height={1080}/>
   <Composition id="Batch" component={Batch} durationInFrames={252} fps={30} width={1920} height={1080}/>
   <Composition id="Freedom" component={Freedom} durationInFrames={372} fps={30} width={1920} height={1080}/>
   <Composition id="Outro" component={Outro} durationInFrames={240} fps={30} width={1920} height={1080}/>
 </Folder>
</>;
