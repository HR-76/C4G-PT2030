import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createHash} from 'node:crypto'
import base from '../../../frontend/vite.config.js'
const root=fileURLToPath(new URL('../../../',import.meta.url))
const variant=process.env.PAGE_VARIANT
if(!['A','B'].includes(variant))throw Error('EXPLICIT_PAGE_VARIANT_REQUIRED')
const files=JSON.parse(fs.readFileSync(new URL('./before/manifest.json',import.meta.url)))
const snapshots=new Map(files.map(row=>{
 const bytes=fs.readFileSync(path.join(root,row.snapshot))
 if(createHash('sha256').update(bytes).digest('hex')!==row.sha256)throw Error('BASELINE_CHANGED')
 return [path.join(root,row.path).replaceAll('\\','/'),bytes.toString('utf8')]
}))
export default {...base,root:path.join(root,'frontend'),plugins:[...(variant==='A'?[{
 name:'frozen-before-sources',enforce:'pre',load(id){return snapshots.get(id.replaceAll('\\','/'))??null}
}]:[]),...base.plugins],build:{outDir:path.join(root,'.tmp/transversal-performance/combined-build-'+variant),emptyOutDir:false}}
