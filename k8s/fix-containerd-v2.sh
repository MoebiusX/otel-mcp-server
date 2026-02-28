#!/bin/bash
# Fix containerd insecure registry for 192.168.1.32:5000
# This script uses BOTH approaches to ensure compatibility
set -e

CONF=/etc/containerd/config.toml

# 1. Ensure hosts.toml exists with server directive
mkdir -p /etc/containerd/certs.d/192.168.1.32:5000
cat > /etc/containerd/certs.d/192.168.1.32:5000/hosts.toml << 'HOSTEOF'
server = "http://192.168.1.32:5000"

[host."http://192.168.1.32:5000"]
  capabilities = ["pull", "resolve", "push"]
  skip_verify = true
HOSTEOF

# 2. Ensure config_path is set in the registry section
# First check if it exists at all
if grep -q 'config_path.*=.*"/etc/containerd/certs.d"' "$CONF" 2>/dev/null; then
  echo "config_path already set correctly"
else
  # Check if registry section exists
  if grep -q '\[plugins."io.containerd.grpc.v1.cri".registry\]' "$CONF" 2>/dev/null; then
    # Replace empty config_path if present
    if grep -q 'config_path = ""' "$CONF"; then
      # Only replace the FIRST occurrence under registry section
      sed -i '0,/config_path = ""/s|config_path = ""|config_path = "/etc/containerd/certs.d"|' "$CONF"
      echo "Replaced empty config_path"
    else
      # Add config_path after the registry section header
      sed -i '/\[plugins."io.containerd.grpc.v1.cri".registry\]/a\      config_path = "/etc/containerd/certs.d"' "$CONF"
      echo "Added config_path after registry section"
    fi
  else
    # Add the entire registry section
    echo '' >> "$CONF"
    echo '[plugins."io.containerd.grpc.v1.cri".registry]' >> "$CONF"
    echo '  config_path = "/etc/containerd/certs.d"' >> "$CONF"
    echo "Added registry section with config_path"
  fi
fi

# 3. Also ensure mirror config exists as fallback
if ! grep -q 'registry.mirrors."192.168.1.32:5000"' "$CONF" 2>/dev/null; then
  cat >> "$CONF" << 'MIRROREOF'

[plugins."io.containerd.grpc.v1.cri".registry.mirrors."192.168.1.32:5000"]
  endpoint = ["http://192.168.1.32:5000"]
[plugins."io.containerd.grpc.v1.cri".registry.configs."192.168.1.32:5000".tls]
  insecure_skip_verify = true
MIRROREOF
  echo "Added mirror config as fallback"
fi

# 4. Restart containerd
systemctl restart containerd
sleep 3
echo "CONTAINERD v2 FIXED on $(hostname)"
