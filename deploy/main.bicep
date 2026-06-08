// Vilma — Azure VM deployment (resource-group scope).
// Provisions an Ubuntu VM running Docker, with networking that opens
// HTTP (80), HTTPS (443), SSH (22) and syslog (UDP 5514).

@description('Azure region for all resources.')
param location string = resourceGroup().location

@description('Base name used for resource names.')
param vmName string = 'vilma'

@description('VM size. Standard_B2s (2 vCPU / 4 GB) is a good low-cost default.')
param vmSize string = 'Standard_B2s'

@description('Admin username for SSH.')
param adminUsername string = 'azureuser'

@description('SSH public key (contents of your .pub file).')
@secure()
param sshPublicKey string

@description('Base64-encoded cloud-init customData (installs Docker, writes compose + .env).')
param customData string

@description('Source CIDR allowed to SSH. Set to your IP (e.g. 203.0.113.5/32). Default * = anywhere.')
param sshSourceAddress string = '*'

@description('Source CIDR allowed to send syslog (UDP 5514). Default * = anywhere.')
param syslogSourceAddress string = '*'

var nsgName = '${vmName}-nsg'
var vnetName = '${vmName}-vnet'
var pipName = '${vmName}-pip'
var nicName = '${vmName}-nic'
var dnsLabel = toLower('${vmName}-${uniqueString(resourceGroup().id)}')

resource nsg 'Microsoft.Network/networkSecurityGroups@2023-09-01' = {
  name: nsgName
  location: location
  properties: {
    securityRules: [
      {
        name: 'SSH'
        properties: {
          priority: 1001
          direction: 'Inbound'
          access: 'Allow'
          protocol: 'Tcp'
          sourceAddressPrefix: sshSourceAddress
          sourcePortRange: '*'
          destinationAddressPrefix: '*'
          destinationPortRange: '22'
        }
      }
      {
        name: 'HTTP'
        properties: {
          priority: 1010
          direction: 'Inbound'
          access: 'Allow'
          protocol: 'Tcp'
          sourceAddressPrefix: '*'
          sourcePortRange: '*'
          destinationAddressPrefix: '*'
          destinationPortRange: '80'
        }
      }
      {
        name: 'HTTPS'
        properties: {
          priority: 1020
          direction: 'Inbound'
          access: 'Allow'
          protocol: 'Tcp'
          sourceAddressPrefix: '*'
          sourcePortRange: '*'
          destinationAddressPrefix: '*'
          destinationPortRange: '443'
        }
      }
      {
        name: 'Syslog-UDP'
        properties: {
          priority: 1030
          direction: 'Inbound'
          access: 'Allow'
          protocol: 'Udp'
          sourceAddressPrefix: syslogSourceAddress
          sourcePortRange: '*'
          destinationAddressPrefix: '*'
          destinationPortRange: '5514'
        }
      }
    ]
  }
}

resource vnet 'Microsoft.Network/virtualNetworks@2023-09-01' = {
  name: vnetName
  location: location
  properties: {
    addressSpace: { addressPrefixes: ['10.42.0.0/16'] }
    subnets: [
      {
        name: 'default'
        properties: {
          addressPrefix: '10.42.1.0/24'
          networkSecurityGroup: { id: nsg.id }
        }
      }
    ]
  }
}

resource pip 'Microsoft.Network/publicIPAddresses@2023-09-01' = {
  name: pipName
  location: location
  sku: { name: 'Standard' }
  properties: {
    publicIPAllocationMethod: 'Static'
    dnsSettings: { domainNameLabel: dnsLabel }
  }
}

resource nic 'Microsoft.Network/networkInterfaces@2023-09-01' = {
  name: nicName
  location: location
  properties: {
    ipConfigurations: [
      {
        name: 'ipconfig1'
        properties: {
          subnet: { id: vnet.properties.subnets[0].id }
          privateIPAllocationMethod: 'Dynamic'
          publicIPAddress: { id: pip.id }
        }
      }
    ]
  }
}

resource vm 'Microsoft.Compute/virtualMachines@2023-09-01' = {
  name: vmName
  location: location
  properties: {
    hardwareProfile: { vmSize: vmSize }
    osProfile: {
      computerName: vmName
      adminUsername: adminUsername
      customData: customData
      linuxConfiguration: {
        disablePasswordAuthentication: true
        ssh: {
          publicKeys: [
            {
              path: '/home/${adminUsername}/.ssh/authorized_keys'
              keyData: sshPublicKey
            }
          ]
        }
      }
    }
    storageProfile: {
      imageReference: {
        publisher: 'Canonical'
        offer: '0001-com-ubuntu-server-jammy'
        sku: '22_04-lts-gen2'
        version: 'latest'
      }
      osDisk: {
        createOption: 'FromImage'
        managedDisk: { storageAccountType: 'StandardSSD_LRS' }
      }
    }
    networkProfile: {
      networkInterfaces: [{ id: nic.id }]
    }
  }
}

output publicIp string = pip.properties.ipAddress
output fqdn string = pip.properties.dnsSettings.fqdn
output sshCommand string = 'ssh ${adminUsername}@${pip.properties.ipAddress}'
output appUrl string = 'http://${pip.properties.dnsSettings.fqdn}'
