#!/bin/bash
# Fix containerd 1.7.x insecure registry for 192.168.1.32:5000
# In containerd 1.7, config_path and mirrors are mutually exclusive.
# We use config_path + hosts.toml approach (recommended).
set -e

CONF=/etc/containerd/config.toml

# 1. Create proper hosts.toml
mkdir -p /etc/containerd/certs.d/192.168.1.32:5000
cat > /etc/containerd/certs.d/192.168.1.32:5000/hosts.toml << 'HOSTEOF'
server = "http://192.168.1.32:5000"

[host."http://192.168.1.32:5000"]
  capabilities = ["pull", "resolve", "push"]
  skip_verify = true
HOSTEOF

# 2. Remove old mirror-style config lines (they conflict with config_path)
sed -i '/registry\.mirrors\."192\.168\.1\.32:5000"/d' "$CONF"
sed -i '/endpoint.*http:\/\/192\.168\.1\.32:5000/d' "$CONF"
sed -i '/registry\.configs\."192\.168\.1\.32:5000"/d' "$CONF"
sed -i '/insecure_skip_verify.*true/d' "$CONF"

# 3. Remove blank lines left behind
sed -i '/^$/N;/^\n$/d' "$CONF"

# 4. Ensure registry section with config_path exists
if grep -q 'config_path.*=.*"/etc/containerd/certs.d"' "$CONF" 2>/dev/null; then
  echo "config_path already correct"
else
  # Remove any existing empty config_path
  sed -i '/config_path = ""/d' "$CONF"
  # Check if registry section header exists
  if grep -q '\[plugins."io.containerd.grpc.v1.cri".registry\]' "$CONF" 2>/dev/null; then
    # Add config_path right after registry section header
    sed -i '/\[plugins."io.containerd.grpc.v1.cri".registry\]/a\  config_path = "/etc/containerd/certs.d"' "$CONF"
    echo "Added config_path under existing registry section"
  else
    # Append the entire registry section
    echo '' >> "$CONF"
    echo '[plugins."io.containerd.grpc.v1.cri".registry]' >> "$CONF"
    echo '  config_path = "/etc/containerd/certs.d"' >> "$CONF"
    echo "Added new registry section with config_path"
  fi
fi

# 5. Restart containerd
systemctl restart containerd
sleep 3

# 6. Verify
echo "--- Config check ---"
grep -A2 'registry\]' "$CONF" | head -5
echo "--- Hosts.toml ---"
cat /etc/containerd/certs.d/192.168.1.32:5000/hosts.toml
echo "CONTAINERD v3 FIXED on $(hostname)"
