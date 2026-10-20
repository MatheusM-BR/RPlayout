import {it,expect} from 'vitest'
import {nativeSocketDiagnosticSchema} from './ownership-diagnostic.js'
it('allows only bounded native table diagnostics, never arbitrary private text',()=>{
 const value={table:'UDP6',phase:'READ',reason:'OS_ERROR',win32Code:5}
 expect(nativeSocketDiagnosticSchema.parse(value)).toEqual(value)
 for(const extra of[{path:'PRIVATE_PATH'},{pid:1234},{nonce:'PRIVATE_NONCE'},{message:'PRIVATE_TEXT'},{requestId:'PRIVATE_ID'}])expect(nativeSocketDiagnosticSchema.safeParse({...value,...extra}).success).toBe(false)
})
it('Windows codes are nonzero DWORD failures, required only for OS_ERROR',()=>{
 for(const win32Code of[0,-1,0x100000000,1.5,NaN,'5',null,undefined])expect(nativeSocketDiagnosticSchema.safeParse({table:'TCP4',phase:'SIZE',reason:'OS_ERROR',win32Code}).success).toBe(false)
 expect(nativeSocketDiagnosticSchema.safeParse({table:'TCP4',phase:'SIZE',reason:'OS_ERROR',win32Code:0xffffffff}).success).toBe(true)
 expect(nativeSocketDiagnosticSchema.safeParse({table:'TCP4',phase:'DECODE',reason:'LAYOUT_INVALID',win32Code:5}).success).toBe(false)
})
it('query failure phase must match its cause; no invented Windows code for layout/growth/owner',()=>{
 for(const value of[{phase:'READ',reason:'TABLE_BOUND'},{phase:'READ',reason:'TABLE_CHANGED'},{phase:'READ',reason:'INCOMPLETE_TABLE'},{phase:'DECODE',reason:'INCOMPLETE_TABLE'},{phase:'DECODE',reason:'LAYOUT_INVALID'},{phase:'OWNER',reason:'UNKNOWN_OWNER'}])expect(nativeSocketDiagnosticSchema.safeParse({table:'UDP4',...value}).success).toBe(true)
 expect(nativeSocketDiagnosticSchema.safeParse({table:'UDP4',phase:'OWNER',reason:'OS_ERROR',win32Code:5}).success).toBe(false)
 expect(nativeSocketDiagnosticSchema.safeParse({table:'TCP4',phase:'SIZE',reason:'UNKNOWN_OWNER'}).success).toBe(false)
})
