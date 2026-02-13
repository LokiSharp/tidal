# 🌊 Tidal

Clash / Surge 代理规则集托管。

规则以 Surge `.list` 格式为唯一源，部署时自动生成 Clash `.yaml` 格式。

## 使用

### Surge

```ini
RULE-SET,https://lokisharp.github.io/tidal/Surge/Provider/Telegram.list,Telegram,extended-matching
```

### Clash

```yaml
rule-providers:
  Telegram:
    type: http
    behavior: classical
    url: 'https://lokisharp.github.io/tidal/Clash/Provider/Telegram.yaml'
    path: ./Rules/Telegram
    interval: 86400
```

## 目录结构

```
rules/
├── Provider/          # 唯一规则源 (.list)
│   ├── AdBlock.list
│   ├── Telegram.list
│   ├── Media/
│   │   ├── Netflix.list
│   │   └── ...
│   └── ...
├── Surge/             # Surge 配置片段
│   ├── Head.conf
│   ├── Rule.conf
│   ├── MitM.conf
│   ├── Module/
│   └── Script/
└── Clash/             # Clash 配置片段
    ├── Head.yaml
    └── Rule.yaml
```

部署时 `scripts/build.sh` 自动将 `.list` 转换为 Clash 的 `.yaml` 格式。

## 部署

推送到 `main` 分支后自动通过 GitHub Actions 部署到 GitHub Pages。

需在 GitHub 仓库设置中启用 Pages（Settings → Pages → Source → GitHub Actions）。
