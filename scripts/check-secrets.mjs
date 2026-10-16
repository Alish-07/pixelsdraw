import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// High-confidence signatures only. Print locations, never credential values.
// This supplements GitHub secret scanning; it is not an exhaustive detector.
const patterns=[
 ['private key',/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
 ['AWS key',/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
 ['GitHub token',/\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,})\b/],
 ['Google client secret',/GOCSPX-[A-Za-z0-9_-]{20,}/],
 ['Supabase secret',/\b(?:sb_secret_|sbp_)[A-Za-z0-9_-]{20,}/],
 ['Brevo key',/\b(?:xkeysib-|xsmtpsib-)[A-Za-z0-9_-]{20,}/],
 ['database password URL',/postgres(?:ql)?:\/\/[^\s:@]+:[^\s@]{8,}@/],
];
const findings=[];
function scan(content,location){
 for(const [kind,pattern] of patterns)if(pattern.test(content))findings.push({kind,location});
 for(const match of content.matchAll(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g)){
  try{if(JSON.parse(Buffer.from(match[0].split('.')[1],'base64url')).role==='service_role')findings.push({kind:'service-role JWT',location});}catch{}
 }
}
const git=args=>execFileSync('git',args,{encoding:'utf8',maxBuffer:64*1024*1024});
for(const path of git(['ls-files','-z']).split('\0').filter(Boolean)){
 if(/(^|\/)\.env(?:\.|$)/.test(path)&&path!=='.env.example')findings.push({kind:'tracked environment file',location:path});
 try{scan(readFileSync(path,'utf8'),path);}catch{}
}
let blobs=0;
for(const object of git(['rev-list','--objects','--all']).trim().split('\n')){
 const [sha,...path]=object.split(' ');
 if(git(['cat-file','-t',sha]).trim()!=='blob')continue;
 scan(git(['cat-file','-p',sha]),`${path.join(' ')} @ ${sha.slice(0,10)}`);blobs++;
}
if(findings.length){console.error(JSON.stringify(findings,null,2));process.exitCode=1;}
else console.log(`PASS: tracked files and ${blobs} history blobs checked; no high-confidence secret signatures found.`);
