import React from 'react';
import {AbsoluteFill} from 'remotion';
import {Backdrop, Brand} from './visuals';

export const Scene: React.FC<{children: React.ReactNode; brand?: boolean}> = ({children, brand=true}) => (
  <AbsoluteFill style={{color:'#f8f9ff',fontFamily:'"Microsoft YaHei", "Segoe UI", sans-serif',background:'#080c18',overflow:'hidden'}}>
    <Backdrop/>
    {children}
    {brand ? <Brand/> : null}
  </AbsoluteFill>
);
