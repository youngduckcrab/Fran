// 브라우저 환경을 흉내 내는 것을 다른 무엇보다 먼저 채운다.
import './src/shims';
import { registerRootComponent } from 'expo';
import App from './src/App';

registerRootComponent(App);
