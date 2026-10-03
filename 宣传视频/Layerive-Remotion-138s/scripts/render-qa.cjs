const path = require('path');
const fs = require('fs');
const {bundle} = require('@remotion/bundler');
const {openBrowser, selectComposition, renderStill} = require('@remotion/renderer');

(async () => {
  const out = path.resolve('qa');
  fs.mkdirSync(out, {recursive:true});
  const serveUrl = await bundle({entryPoint:path.resolve('src/index.ts'), outDir:path.resolve('build')});
  const browser = await openBrowser('chrome', {browserExecutable:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  try {
    const composition = await selectComposition({serveUrl,id:'LayerivePromo',puppeteerInstance:browser});
    console.log(JSON.stringify({duration:composition.durationInFrames/composition.fps,width:composition.width,height:composition.height}));
    const frames = process.argv.slice(2).length ? process.argv.slice(2).map(Number) : [37,125,266,357,465,581,670,792,897,1005,1115,1310,1550,1740];
    for (let i=0;i<frames.length;i+=2) {
      await Promise.all(frames.slice(i,i+2).map(async frame=>{
        await renderStill({serveUrl,composition,puppeteerInstance:browser,frame,output:path.join(out,`frame-${frame}.png`),imageFormat:'png',timeoutInMilliseconds:60000});
        console.log(`Rendered frame ${frame}`);
      }));
    }
  } finally {await browser.close({silent:true});}
})();
