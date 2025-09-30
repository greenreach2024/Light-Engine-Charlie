param environment string
param location string
param sku string

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2023-03-01-preview' = {
  name: 'buyer-registry-${environment}-pg'
  location: location
  sku: {
    name: sku
    tier: 'GeneralPurpose'
    capacity: 2
  }
  properties: {
    administratorLogin: 'buyeradmin'
    administratorLoginPassword: 'ChangeMe!123'
    version: '14'
    storage: {
      storageSizeGB: 128
    }
  }
}

output connectionString string = 'postgresql://buyeradmin:ChangeMe!123@' + postgres.name + '.postgres.database.azure.com/postgres'
