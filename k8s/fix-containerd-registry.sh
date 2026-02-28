#!/bin/bash
# Fix containerd insecure registry for 192.168.1.32:5000
set -e

# Fix config_path in containerd config
sed -i 's|config_path = ""|config_path = "/etc/containerd/certs.d"|g' /etc/containerd/config.toml

# Create hosts.toml for the registry
mkdir -p /etc/containerd/certs.d/192.168.1.32:5000
cat > /etc/containerd/certs.d/192.168.1.32:5000/hosts.toml << 'HOSTEOF'
server = "http://192.168.1.32:5000"

[host."http://192.168.1.32:5000"]
  capabilities = ["pull", "resolve", "push"]
  skip_verify = true
HOSTEOF

# Restart containerd
systemctl restart containerd
sleep 3
echo "CONTAINERD FIXED on $(hostname)"
