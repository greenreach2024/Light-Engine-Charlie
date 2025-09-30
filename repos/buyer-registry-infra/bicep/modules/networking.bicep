param environment string
param location string

resource vnet 'Microsoft.Network/virtualNetworks@2023-09-01' = {
  name: 'buyer-registry-${environment}-vnet'
  location: location
  properties: {
    addressSpace: {
      addressPrefixes: [
        '10.20.0.0/16'
      ]
    }
    subnets: [
      {
        name: 'app'
        properties: {
          addressPrefix: '10.20.1.0/24'
        }
      }
    ]
  }
}

output vnetId string = vnet.id
