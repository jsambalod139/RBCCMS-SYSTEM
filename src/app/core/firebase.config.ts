import { getApp, getApps, initializeApp } from 'firebase/app';

const firebaseConfig = {
  apiKey: 'AIzaSyBZu8FyuKougqQtqLA3R1s63XZXe6Fm05E',
  authDomain: 'rbccms-system.firebaseapp.com',
  projectId: 'rbccms-system',
  storageBucket: 'rbccms-system.firebasestorage.app',
  messagingSenderId: '1030001076380',
  appId: '1:1030001076380:web:00e241e4a958358c986559',
  measurementId: 'G-3S72VW433P',
};

export const firebaseApp = getApps().length
  ? getApp()
  : initializeApp(firebaseConfig);