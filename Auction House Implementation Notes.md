# Auction House Integration - Implementation Notes

## Overview
Phase 1 of the auction house integration for profession planning is now complete. This document provides comprehensive implementation details and guidance for future development.

## Database Schema

### New Tables Created

1. **auction_prices**
   - Stores historical auction price data for items
   - Fields: id, item_id, realm_slug, price, quantity, time_left, last_seen
   - Indexed on (item_id, realm_slug) for fast lookups

2. **current_auctions**
   - Real-time auction house listings
   - Fields: id, item_id, realm_slug, price, quantity, time_left, last_updated
   - Refreshed on each auction house update

3. **profession_mains**
   - Designates which character is the main for each profession
   - Fields: id, user_id, profession_name, character_name, realm_slug, created_at

4. **price_alerts**
   - User-configured price alerts for items
   - Fields: id, user_id, item_id, realm_slug, target_price, is_active, created_at

## API Endpoints

### Public Endpoints

1. **GET /api/profession-cost-analysis/:professionName**
   - Calculates total cost to complete missing recipes for a profession
   - Returns breakdown by character with auction house pricing
   - Requires authentication (user session)

2. **POST/GET /api/profession-main**
   - Set or get profession main character assignments
   - POST: { profession: string, character: string, realm: string }
   - GET: Returns all assignments for authenticated user

3. **GET /api/profession-mains**
   - Returns all profession main assignments for authenticated user

### Admin Endpoints

1. **POST /api/admin/update-auction-house**
   - Manually trigger auction house data update for all realms
   - Returns: { success: boolean, realmsUpdated: number, details: object }

2. **GET /api/admin/auction-house-status**
   - Check status of auction house data (last update times, data freshness)
   - Returns detailed status for all realms with auction data

3. **POST /api/admin/cleanup-auction-data**
   - Remove auction data older than 24 hours
   - Returns: { success: boolean, recordsRemoved: number }

## Key Functions

### Database Functions (database-postgresql.js)

1. **upsertAuctionData(auctionData)**
   - Efficiently updates both current_auctions and auction_prices tables
   - Uses PostgreSQL UPSERT for optimal performance

2. **getCurrentAuctionPrices(itemIds, realmSlug)**
   - Retrieves current lowest prices for specified items on a realm
   - Returns Map<itemId, priceData> for fast lookups

3. **getRecipeCostAnalysis(professionName, userId)**
   - Core function for profession cost analysis
   - Combines character recipe data with auction house pricing
   - Returns complete cost breakdown by character

4. **setProfessionMain(userId, profession, character, realm)**
   - Assigns a character as the main for a profession
   - Handles realm slug conversion for consistency

5. **getProfessionMains(userId)**
   - Retrieves all profession main assignments for a user

### Server Functions (server.js)

1. **updateAuctionHouseData(realmSlug)**
   - Fetches auction data from Battle.net API
   - Processes and stores in database
   - Includes rate limiting and error handling

2. **getConnectedRealmId(realmSlug)**
   - Resolves connected realm IDs for auction house queries
   - Caches results for performance

## Battle.net API Integration

### Authentication
- Uses OAuth 2.0 client credentials flow
- Tokens are cached and automatically refreshed
- Requests include proper authentication headers

### Rate Limiting
- Implements exponential backoff for API requests
- Respects Battle.net API rate limits
- Includes retry logic for failed requests

### Data Processing
- Filters auction data for profession-relevant items
- Converts Battle.net auction format to internal schema
- Handles item name resolution via item API

## Security Considerations

### Data Protection
- All auction data endpoints require user authentication
- User data is isolated by user_id in database queries
- No sensitive API keys exposed to client-side code

### Input Validation
- Profession names validated against known profession list
- Realm slugs sanitized and validated
- Character names validated for format and length

## Performance Optimizations

### Database Indexing
- Composite indexes on (item_id, realm_slug) for fast price lookups
- Indexes on user_id for user-specific queries
- Timestamp indexes for efficient data cleanup

### Caching Strategy
- Connected realm IDs cached in memory
- Battle.net OAuth tokens cached with automatic refresh
- Auction data is bulk-updated rather than individual inserts

### Async Processing
- Auction data updates run asynchronously
- Large datasets processed in batches
- Progress tracking for long-running operations

## Admin Panel Integration

### New Admin Controls
- **Auction House Management** section added to admin panel
- Real-time auction data update controls
- Status monitoring and data cleanup tools
- Profession main assignment viewing

### Monitoring Features
- Auction data freshness tracking
- Update success/failure logging
- Performance metrics for large operations

## Future Enhancement Opportunities (Phase 2)

### Historical Analytics
- Price trend tracking over time
- Seasonal pricing pattern analysis
- Server transfer cost comparison tools

### Advanced Alerts
- Real-time price drop notifications
- Cross-server arbitrage opportunities
- Bulk purchase recommendations

### UI Enhancements
- Interactive profession planning dashboard
- Visual cost breakdown charts
- Shopping list export functionality

## Configuration Requirements

### Environment Variables
```
BLIZZARD_CLIENT_ID=your_client_id
BLIZZARD_CLIENT_SECRET=your_client_secret
```

### Database Permissions
- Tables require CREATE, INSERT, UPDATE, DELETE permissions
- Index creation permissions for optimization
- Transaction support for data consistency

## Testing Strategy

### Unit Tests
- Database function validation
- API endpoint response testing
- Error handling verification

### Integration Tests
- Battle.net API connectivity
- End-to-end profession cost analysis
- Data consistency across updates

### Performance Tests
- Large dataset processing
- Concurrent user request handling
- Memory usage during bulk operations

## Deployment Considerations

### Database Migration
- New tables created automatically on first run
- Initialization lock prevents concurrent setup conflicts
- Graceful handling of existing table scenarios

### Monitoring
- Log all auction house API interactions
- Track update success rates and timing
- Monitor database performance metrics

### Backup Strategy
- Regular backup of auction_prices historical data
- Export functionality for profession main assignments
- Data retention policies for old auction data

## Support and Maintenance

### Regular Tasks
- Monitor auction data freshness (daily)
- Clean up old auction records (weekly)
- Review profession main assignments (monthly)
- Performance optimization review (quarterly)

### Troubleshooting
- Check Battle.net API connectivity for failed updates
- Verify database constraints for foreign key errors
- Monitor memory usage during large auction updates
- Review rate limiting logs for API throttling issues

This implementation provides a solid foundation for profession planning with real-time auction house integration while maintaining performance, security, and scalability for future enhancements.