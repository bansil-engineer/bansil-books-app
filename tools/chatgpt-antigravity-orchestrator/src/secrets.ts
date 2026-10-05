import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export type Provider = 'openai'|'gemini'|'claude';
export type SavedSecrets = Record<Provider,string>;
const empty=():SavedSecrets=>({openai:'',gemini:'',claude:''});

export class SecretsVault {
  private token:string;
  private file:string;
  constructor(token:string,file=path.join(process.cwd(),'data','api-keys.enc')){this.token=token;this.file=file}
  load():SavedSecrets{
    try{
      const packed=JSON.parse(readFileSync(this.file,'utf8'));
      if(packed.version!==1)throw new Error('unsupported version');
      const salt=Buffer.from(packed.salt,'base64'),iv=Buffer.from(packed.iv,'base64');
      const decipher=createDecipheriv('aes-256-gcm',scryptSync(this.token,salt,32),iv);
      decipher.setAuthTag(Buffer.from(packed.tag,'base64'));
      const value=JSON.parse(Buffer.concat([decipher.update(Buffer.from(packed.data,'base64')),decipher.final()]).toString('utf8'));
      return {openai:String(value.openai||''),gemini:String(value.gemini||''),claude:String(value.claude||'')};
    }catch(e:any){
      if(e?.code==='ENOENT')return empty();
      throw new Error('Saved API keys could not be unlocked. Restore the same owner token or clear the encrypted key file.');
    }
  }
  save(value:SavedSecrets){
    const salt=randomBytes(16),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',scryptSync(this.token,salt,32),iv);
    const data=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
    const packed=JSON.stringify({version:1,salt:salt.toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')});
    mkdirSync(path.dirname(this.file),{recursive:true,mode:0o700});
    const temp=`${this.file}.${process.pid}.tmp`;
    writeFileSync(temp,packed,{encoding:'utf8',mode:0o600,flag:'w'}); chmodSync(temp,0o600); renameSync(temp,this.file); chmodSync(this.file,0o600);
  }
}
