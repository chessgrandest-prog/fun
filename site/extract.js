const fs = require('fs');

const workerPath = 'worker.js';
const workerContent = fs.readFileSync(workerPath, 'utf8');

const ghostUiMatch = workerContent.match(/if \(path === '\/ghost-ui'\) \{\s*return new Response\((.*?),\s*\{\s*headers/s);
if (ghostUiMatch) {
    let ghostUiStr = ghostUiMatch[1];
    let html = eval(ghostUiStr);
    fs.writeFileSync('ghost-ui.html', html);
    console.log('ghost-ui.html extracted successfully.');
} else {
    console.log('Could not find ghost-ui');
}

const scriptJsMatch = workerContent.match(/if \(path === '\/script\.js'\) \{\s*return new Response\((.*?),\s*\{\s*headers/s);
if (scriptJsMatch) {
    let scriptJsStr = scriptJsMatch[1];
    let js = eval(scriptJsStr);
    fs.writeFileSync('script.js', js);
    console.log('script.js extracted successfully.');
} else {
    console.log('Could not find script.js');
}
