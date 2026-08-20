import { createApp } from 'vue'
import App from './App.vue'
import './styles/tokens.css'
import './styles/base.css'
import './styles/animations.css'
import './style.css'
import './styles/polish.css'
import './styles/shine.css'
import './styles/signature.css'
import './styles/narrative.css'

import { vRipple } from './fx/vRipple'

const app = createApp(App)
app.directive('ripple', vRipple)
app.mount('#app')
