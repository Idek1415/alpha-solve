import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { Buffer } from 'buffer';

// Polyfills for browser environment (required by isomorphic-git)
(window as any).Buffer = Buffer;
(window as any).global = window;
(window as any).process = {
  env: {},
  version: '',
  versions: {},
  platform: 'browser',
  nextTick: (fn: Function) => setTimeout(fn, 0)
};

bootstrapApplication(App, appConfig)
  .catch((err) => console.error(err));
