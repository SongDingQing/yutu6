#!/usr/bin/env bash
# Gitee SSH 诊断(在 Mac 本机跑)。只看文件名 / config / 指纹,绝不打印任何私钥内容。
# 结果写到工作区文件,总管直接读。
HERE="$(cd "$(dirname "$0")" && pwd)"
REPORT="$HERE/../artifacts/gitee-ssh-diag.txt"; mkdir -p "$(dirname "$REPORT")"
exec > >(tee "$REPORT") 2>&1
echo "===== Gitee SSH 诊断 $(date) (不打印私钥内容) ====="
echo ""; echo "--- ~/.ssh 里的文件(只列名+权限)---"
ls -la ~/.ssh 2>/dev/null | awk '{print $1"  "$NF}' || echo "(没有 ~/.ssh)"
echo ""; echo "--- ~/.ssh/config 的 gitee 段 ---"
grep -A6 -i "gitee" ~/.ssh/config 2>/dev/null || echo "(config 里没有 gitee 段 → place-gitee-key.sh 还没跑/没写进去)"
echo ""; echo "--- ssh-agent 已加载的 key(只有指纹,无私钥)---"
ssh-add -l 2>&1
echo ""; echo "--- 工作区暂存区是否还在(在=说明 place 脚本没跑)---"
ls -la "$HERE/../.ssh-stage" 2>/dev/null | awk '{print $1"  "$NF}' || echo "(暂存区已清空 → place 脚本应已跑过)"
echo ""; echo "--- 用约定路径的 key 测 Gitee 认证(verbose 末几行)---"
if [ -f ~/.ssh/id_ed25519_gitee_yutu6 ]; then
  ssh -i ~/.ssh/id_ed25519_gitee_yutu6 -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -T git@gitee.com 2>&1 | tail -4
else
  echo "(~/.ssh/id_ed25519_gitee_yutu6 不存在 → 私钥还没装进 ~/.ssh,跑 place-gitee-key.sh 即可)"
fi
echo ""; echo "===== 诊断完。把 artifacts/gitee-ssh-diag.txt 发我(或贴这段)====="
