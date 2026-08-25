import { defineConfig } from '@playwright/test';
// R14 P2 rerun: unread + draft restore without overwriting new typing
export default defineConfig({
  testDir:'./tests',testMatch:['**/chat-r14p2.spec.mjs'],timeout:120000,expect:{timeout:9000},workers:1,retries:0,reporter:[['line']],
  use:{baseURL:process.env.PRIME_URL||'https://prime-online-v01.vercel.app/',channel:'chrome',trace:'retain-on-failure',screenshot:'only-on-failure',video:'retain-on-failure',actionTimeout:9000,navigationTimeout:25000},
  projects:[
    {name:'iphone-15-pro',use:{browserName:'chromium',viewport:{width:393,height:852},deviceScaleFactor:3,isMobile:true,hasTouch:true}},
    {name:'compact-iphone',use:{browserName:'chromium',viewport:{width:375,height:667},deviceScaleFactor:2,isMobile:true,hasTouch:true}}
  ]
});
