const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const config = getDefaultConfig(__dirname);

// 서버·웹과 같이 쓰는 타입 정의(shared/)가 앱 폴더 밖에 있다.
// 그 폴더를 감시 대상에 넣어야 metro 가 따라 들어간다.
config.watchFolders = [path.resolve(__dirname, '../shared')];

module.exports = config;
