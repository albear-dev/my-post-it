/**
 * @file Electron 런처 — VSCode 터미널에서 ELECTRON_RUN_AS_NODE 환경변수 제거
 *
 * VSCode 내장 터미널은 ELECTRON_RUN_AS_NODE=1 을 설정하는데,
 * 이 값이 남아 있으면 Electron이 브라우저 프로세스 대신 Node.js 모드로 실행된다.
 * 이 스크립트에서 해당 변수를 제거한 뒤 Electron을 spawn한다.
 */
const { spawn } = require('child_process');
const electronPath = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, ['.'], { stdio: 'inherit', env });
child.on('close', (code) => process.exit(code ?? 1));
