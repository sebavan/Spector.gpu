import React from 'react';
import { createRoot } from 'react-dom/client';
import { ResultApp } from './components/ResultApp';
import '../../styles/result.scss';

const container = document.getElementById('root')!;
const root = createRoot(container);
root.render(<ResultApp />);
