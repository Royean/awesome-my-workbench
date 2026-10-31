'use client';
import { useEffect } from 'react';
export default function Workbench(){useEffect(()=>{if(document.querySelector('script[data-workbench]'))return;const script=document.createElement('script');script.type='module';script.src='/app.js';script.dataset.workbench='true';document.body.appendChild(script)},[]);return <><div id="app"/><div id="overlay"/><div id="toast" role="status" aria-live="polite"/></>}
