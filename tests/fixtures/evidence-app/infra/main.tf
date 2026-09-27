terraform {
  required_providers { azurerm = { source = "hashicorp/azurerm", version = "~> 4.0" } }
}
resource "azurerm_resource_group" "app" {
  name = var.resource_group_name
  location = var.location
}
resource "azurerm_key_vault" "app" {
  name = var.vault_name
  resource_group_name = azurerm_resource_group.app.name
  location = azurerm_resource_group.app.location
  tenant_id = var.tenant_id
  sku_name = "standard"
}
