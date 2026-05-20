import { mount } from 'svelte'

import App from './App.svelte'
import './index.css'

const target = document.getElementById('root')

if (!target) {
  throw new Error('Root element #root not found')
}

mount(App, { target })
