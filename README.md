# 🌊 Tidal

Clash / Surge 代理规则集托管。

规则以 Clash/Mihomo `payload` YAML 格式为唯一源，部署时自动生成 Surge `.list` 格式。

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
├── Surge/             # Surge 配置片段
│   ├── Head.conf
│   ├── Rule.conf
│   ├── MitM.conf
│   ├── Module/
│   └── Script/
└── Clash/             # Clash 配置片段
    ├── Head.yaml
    ├── Rule.yaml
    └── Provider/      # 唯一规则源 (.yaml)
        ├── AdBlock.yaml
        ├── Telegram.yaml
        ├── Media/
        │   ├── Netflix.yaml
        │   └── ...
        └── ...
```

部署时 `npm run build` 会复制 Clash 原始 YAML，并自动生成 Surge 的 `.list` Provider。Clash/Mihomo 独有规则在生成 Surge 时会被跳过并输出 warning；Surge 独有规则不应写入 Clash 源 Provider。

## 部署

推送到 `main` 分支后自动通过 GitHub Actions 部署到 GitHub Pages。

需在 GitHub 仓库设置中启用 Pages（Settings → Pages → Source → GitHub Actions）。
