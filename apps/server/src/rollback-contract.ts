import {currentRollbackContract} from './domain/rollback-contract.js'
if(process.argv.length!==3||process.argv[2]!=='--describe'){process.stderr.write('Use --describe, sem banco, cofre ou ativação.\n');process.exitCode=1}
else process.stdout.write(JSON.stringify(currentRollbackContract())+'\n')
