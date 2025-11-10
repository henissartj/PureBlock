{
  "manifest_version": 3,
  "name": "PureBlock",
  "version": "6.2.0",
  "description": "Browse pure, stay secure.",
  "icons": {
    "16": "icons/icon-16.png",
    "32": "icons/icon-32.png",
    "48": "icons/icon-48.png",
    "128": "icons/icon-128.png"
  },
  "action": {
    "default_popup": "popup.html",
    "default_icon": {
      "16": "icons/icon-16.png",
      "32": "icons/icon-32.png"
    }
  },
  "background": {
    "service_worker": "background.js",
    "type": "module"
  },
  "permissions": [
    "storage",
    "declarativeNetRequest",
    "declarativeNetRequestFeedback"
  ],
  "host_permissions": [
    "<all_urls>"
  ],
  "declarative_net_request": {
    "rule_resources": [
      {
        "id": "yt-static-rules",
        "enabled": true,
        "path": "rules_yt_ads.json"
      }
    ]
  },
  "content_scripts": [
    {
      "matches": ["*://*.youtube.com/*"],
      "js": ["youtube.js"],
      "run_at": "document_start"
    }
  ],
  "browser_specific_settings": {
    "gecko": {
      "id": "epheverisme.art",
      "strict_min_version": "115.0"
    }
  }
}
