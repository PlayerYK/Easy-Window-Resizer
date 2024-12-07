#!/bin/bash

# 从 manifest.json 中获取版本号
VERSION=$(grep -o '"version": *"[^"]*"' manifest.json | grep -o '"[^"]*"$' | tr -d '"')

# 打包文件名
FILENAME="Easy_window_resizer_v${VERSION}.zip"

# 创建打包命令
zip -r "${FILENAME}" . -x "store/*" "README.md" "build.sh" "build.bat" "*.git*" "*.DS_Store"

echo "打包完成: ${FILENAME}" 