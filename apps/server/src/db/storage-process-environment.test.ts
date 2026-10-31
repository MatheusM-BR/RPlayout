import {it,expect} from 'vitest'
import {storageProcessEnvironment} from './storage-process-environment.js'
it('preserva somente runtime/localidade/module lookup, sem alterar o ambiente original',()=>{
 const original=Object.freeze({SystemRoot:'C:\\Windows',WINDIR:'C:\\Windows',Path:'RUNTIME_PATH',PATHEXT:'.EXE;.CMD',TEMP:'QA_TEMP',TMP:'QA_TEMP',NODE_PATH:'QA_MODULES',LANG:'pt_BR.UTF-8',LC_ALL:'C',LC_CTYPE:'C',TZ:'America/Sao_Paulo'})
 expect(storageProcessEnvironment(original)).toEqual({SYSTEMROOT:original.SystemRoot,WINDIR:original.WINDIR,PATH:original.Path,PATHEXT:original.PATHEXT,TEMP:original.TEMP,TMP:original.TMP,NODE_PATH:original.NODE_PATH,LANG:original.LANG,LC_ALL:original.LC_ALL,LC_CTYPE:original.LC_CTYPE,TZ:original.TZ})
 expect(original).not.toHaveProperty('PATH')
})
it.each(['RPLAYOUT_ADMIN_PASSWORD','rplayout_vault_key','RPLAYOUT_CONTROL_TOKEN','RPLAYOUT_STORAGE_FILE','OPENAI_API_KEY','FUTURE_SECRET','NODE_OPTIONS','NODE_CHANNEL_FD','NODE_UNIQUE_ID','HTTP_PROXY','MTX_CONFKEY','RPLAYOUT_OMT_RUNTIME'])('não herda %s, inclusive opções e destinos fora do contrato',key=>{
 expect(storageProcessEnvironment({[key]:'PRIVATE_NOT_FOR_SQLITE'})).toEqual({})
})
it('normaliza nomes sem duplicar PATH e não reintroduz variantes de credenciais',()=>{
 expect(storageProcessEnvironment({Path:'FIRST',PATH:'SECOND',node_path:'MODULES',Rplayout_Admin_Password:'PRIVATE',TZ:undefined})).toEqual({PATH:'FIRST',NODE_PATH:'MODULES'})
})
