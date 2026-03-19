import { createRoot } from 'react-dom/client';
import { PopupApp } from './components/PopupApp';
import '../../styles/popup.scss';

const container = document.getElementById('root')!;
const root = createRoot(container);
root.render(<PopupApp />);
