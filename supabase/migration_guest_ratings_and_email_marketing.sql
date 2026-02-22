-- ============================================
-- Guest Ratings & Email Marketing Migration
-- ============================================

-- ============================================
-- 1. Guest Ratings & Feedback Table
-- ============================================
CREATE TABLE IF NOT EXISTS guest_ratings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    reservation_id UUID REFERENCES reservations(id) ON DELETE SET NULL,
    visit_log_id UUID REFERENCES customer_visit_logs(id) ON DELETE SET NULL,
    
    -- Rating details
    overall_rating INTEGER NOT NULL CHECK (overall_rating >= 1 AND overall_rating <= 5),
    food_rating INTEGER CHECK (food_rating >= 1 AND food_rating <= 5),
    service_rating INTEGER CHECK (service_rating >= 1 AND service_rating <= 5),
    ambiance_rating INTEGER CHECK (ambiance_rating >= 1 AND ambiance_rating <= 5),
    value_rating INTEGER CHECK (value_rating >= 1 AND value_rating <= 5),
    
    -- Feedback text
    feedback_text TEXT,
    positive_aspects TEXT[], -- What they liked
    improvement_areas TEXT[], -- What could be better
    
    -- Would recommend (NPS-style)
    would_recommend BOOLEAN,
    likelihood_to_return INTEGER CHECK (likelihood_to_return >= 1 AND likelihood_to_return <= 10),
    
    -- Staff mentions
    server_name VARCHAR(100),
    staff_mentioned TEXT[], -- Staff members mentioned positively
    
    -- Visit context
    visit_date DATE NOT NULL,
    party_size INTEGER,
    
    -- Status
    is_published BOOLEAN DEFAULT false,
    is_responded BOOLEAN DEFAULT false,
    response_text TEXT,
    responded_at TIMESTAMP WITH TIME ZONE,
    responded_by UUID REFERENCES restaurant_users(id),
    
    -- For low rating alerts
    is_alert_sent BOOLEAN DEFAULT false,
    alert_sent_at TIMESTAMP WITH TIME ZONE,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_guest_ratings_restaurant ON guest_ratings(restaurant_id);
CREATE INDEX idx_guest_ratings_customer ON guest_ratings(customer_id);
CREATE INDEX idx_guest_ratings_rating ON guest_ratings(overall_rating);
CREATE INDEX idx_guest_ratings_date ON guest_ratings(visit_date);
CREATE INDEX idx_guest_ratings_alert ON guest_ratings(is_alert_sent, overall_rating) WHERE overall_rating <= 3;

-- ============================================
-- 2. Rating Analytics Materialized View
-- ============================================
CREATE MATERIALIZED VIEW IF NOT EXISTS rating_analytics AS
SELECT 
    restaurant_id,
    DATE_TRUNC('month', visit_date) as month,
    COUNT(*) as total_ratings,
    AVG(overall_rating) as avg_overall_rating,
    AVG(food_rating) as avg_food_rating,
    AVG(service_rating) as avg_service_rating,
    AVG(ambiance_rating) as avg_ambiance_rating,
    AVG(value_rating) as avg_value_rating,
    COUNT(*) FILTER (WHERE overall_rating = 5) as five_star_count,
    COUNT(*) FILTER (WHERE overall_rating = 4) as four_star_count,
    COUNT(*) FILTER (WHERE overall_rating = 3) as three_star_count,
    COUNT(*) FILTER (WHERE overall_rating = 2) as two_star_count,
    COUNT(*) FILTER (WHERE overall_rating = 1) as one_star_count,
    COUNT(*) FILTER (WHERE would_recommend = true) as would_recommend_count,
    ROUND(100.0 * COUNT(*) FILTER (WHERE would_recommend = true) / NULLIF(COUNT(*), 0), 2) as nps_score
FROM guest_ratings
GROUP BY restaurant_id, DATE_TRUNC('month', visit_date);

CREATE UNIQUE INDEX idx_rating_analytics_unique ON rating_analytics(restaurant_id, month);

-- ============================================
-- 3. Email Campaigns Table
-- ============================================
CREATE TABLE IF NOT EXISTS email_campaigns (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    
    -- Campaign details
    name VARCHAR(200) NOT NULL,
    subject VARCHAR(300) NOT NULL,
    
    -- Content
    template_id UUID, -- Reference to email_templates
    html_content TEXT,
    text_content TEXT,
    
    -- Targeting
    target_segment VARCHAR(50), -- 'all', 'vip', 'at_risk', 'new', 'regulars', 'lapsed'
    custom_filters JSONB, -- Flexible filtering: {"min_visits": 5, "tags": ["VIP"]}
    recipient_count INTEGER DEFAULT 0,
    
    -- Scheduling
    status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'sending', 'sent', 'paused', 'cancelled')),
    scheduled_at TIMESTAMP WITH TIME ZONE,
    sent_at TIMESTAMP WITH TIME ZONE,
    
    -- Performance metrics
    opened_count INTEGER DEFAULT 0,
    clicked_count INTEGER DEFAULT 0,
    bounced_count INTEGER DEFAULT 0,
    unsubscribed_count INTEGER DEFAULT 0,
    conversion_count INTEGER DEFAULT 0, -- Reservations made from campaign
    
    -- A/B Testing
    is_ab_test BOOLEAN DEFAULT false,
    ab_test_variant VARCHAR(10), -- 'A' or 'B'
    ab_test_parent_id UUID REFERENCES email_campaigns(id),
    
    -- Metadata
    created_by UUID REFERENCES restaurant_users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_email_campaigns_restaurant ON email_campaigns(restaurant_id);
CREATE INDEX idx_email_campaigns_status ON email_campaigns(status);
CREATE INDEX idx_email_campaigns_scheduled ON email_campaigns(scheduled_at) WHERE status = 'scheduled';

-- ============================================
-- 4. Email Templates Table
-- ============================================
CREATE TABLE IF NOT EXISTS email_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    restaurant_id UUID NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
    
    -- Template details
    name VARCHAR(200) NOT NULL,
    category VARCHAR(50) NOT NULL CHECK (category IN (
        'welcome', 'confirmation', 'reminder', 'follow_up', 
        'promotional', 'event', 'birthday', 'win_back', 'loyalty'
    )),
    
    -- Content
    subject_template VARCHAR(300) NOT NULL,
    html_template TEXT NOT NULL,
    text_template TEXT,
    
    -- Variables that can be used: {{customer_name}}, {{restaurant_name}}, {{reservation_date}}, etc.
    available_variables TEXT[],
    
    -- Template settings
    is_default BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    preview_image_url TEXT,
    
    -- Usage stats
    usage_count INTEGER DEFAULT 0,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_email_templates_restaurant ON email_templates(restaurant_id);
CREATE INDEX idx_email_templates_category ON email_templates(category);

-- ============================================
-- 5. Email Campaign Recipients (for tracking)
-- ============================================
CREATE TABLE IF NOT EXISTS email_campaign_recipients (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    campaign_id UUID NOT NULL REFERENCES email_campaigns(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    
    -- Email details
    email_address VARCHAR(255) NOT NULL,
    
    -- Tracking
    sent_at TIMESTAMP WITH TIME ZONE,
    delivered_at TIMESTAMP WITH TIME ZONE,
    opened_at TIMESTAMP WITH TIME ZONE,
    clicked_at TIMESTAMP WITH TIME ZONE,
    bounced_at TIMESTAMP WITH TIME ZONE,
    unsubscribed_at TIMESTAMP WITH TIME ZONE,
    
    -- Multiple opens/clicks tracking
    open_count INTEGER DEFAULT 0,
    click_count INTEGER DEFAULT 0,
    
    -- Links clicked
    links_clicked JSONB DEFAULT '[]', -- [{"url": "...", "clicked_at": "..."}]
    
    -- Status
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'delivered', 'opened', 'clicked', 'bounced', 'unsubscribed')),
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_email_recipients_campaign ON email_campaign_recipients(campaign_id);
CREATE INDEX idx_email_recipients_customer ON email_campaign_recipients(customer_id);
CREATE INDEX idx_email_recipients_status ON email_campaign_recipients(status);

-- ============================================
-- 6. Default Email Templates
-- ============================================
-- Note: Default templates are created per restaurant via application code
-- when a new restaurant is onboarded. The template structure is:
-- 
-- Template Categories:
-- - welcome: Welcome New Guest
-- - confirmation: Reservation Confirmation  
-- - reminder: Reservation Reminder
-- - follow_up: Post-Visit Thank You
-- - promotional: Special Offers
-- - event: Event Invitations
-- - birthday: Birthday Special
-- - win_back: We Miss You / Come Back
-- - loyalty: Loyalty Program
--
-- Available Variables for Templates:
-- - {{customer_name}} - Guest name
-- - {{restaurant_name}} - Restaurant name
-- - {{booking_link}} - Direct booking URL
-- - {{party_size}} - Number of guests
-- - {{reservation_date}} - Date of reservation
-- - {{reservation_time}} - Time of reservation
-- - {{restaurant_address}} - Restaurant address
-- - {{visit_date}} - Date of visit
-- - {{feedback_link}} - Feedback form URL
-- - {{discount_code}} - Promotional code

-- ============================================
-- 7. Functions for Email Marketing
-- ============================================

-- Function to get customers for a segment
CREATE OR REPLACE FUNCTION get_customers_for_segment(
    p_restaurant_id UUID,
    p_segment VARCHAR(50),
    p_custom_filters JSONB DEFAULT NULL
)
RETURNS TABLE (customer_id UUID, name VARCHAR, email VARCHAR) AS $$
BEGIN
    CASE p_segment
        WHEN 'all' THEN
            RETURN QUERY
            SELECT c.id, c.name, c.email
            FROM customers c
            WHERE c.restaurant_id = p_restaurant_id AND c.email IS NOT NULL;
            
        WHEN 'vip' THEN
            RETURN QUERY
            SELECT c.id, c.name, c.email
            FROM customers c
            WHERE c.restaurant_id = p_restaurant_id 
            AND c.email IS NOT NULL
            AND c.tags @> ARRAY['VIP']::varchar[];
            
        WHEN 'at_risk' THEN
            RETURN QUERY
            SELECT c.id, c.name, c.email
            FROM customers c
            WHERE c.restaurant_id = p_restaurant_id 
            AND c.email IS NOT NULL
            AND c.risk_level = 'High';
            
        WHEN 'new' THEN
            RETURN QUERY
            SELECT c.id, c.name, c.email
            FROM customers c
            WHERE c.restaurant_id = p_restaurant_id 
            AND c.email IS NOT NULL
            AND c.total_visits <= 2
            AND c.created_at > NOW() - INTERVAL '30 days';
            
        WHEN 'regulars' THEN
            RETURN QUERY
            SELECT c.id, c.name, c.email
            FROM customers c
            WHERE c.restaurant_id = p_restaurant_id 
            AND c.email IS NOT NULL
            AND c.total_visits >= 5
            AND c.last_visit_date > NOW() - INTERVAL '90 days';
            
        WHEN 'lapsed' THEN
            RETURN QUERY
            SELECT c.id, c.name, c.email
            FROM customers c
            WHERE c.restaurant_id = p_restaurant_id 
            AND c.email IS NOT NULL
            AND c.total_visits >= 3
            AND (c.last_visit_date < NOW() - INTERVAL '90 days' OR c.last_visit_date IS NULL);
            
        ELSE
            RETURN QUERY
            SELECT c.id, c.name, c.email
            FROM customers c
            WHERE c.restaurant_id = p_restaurant_id AND c.email IS NOT NULL;
    END CASE;
END;
$$ LANGUAGE plpgsql;

-- Function to calculate campaign stats
CREATE OR REPLACE FUNCTION calculate_campaign_stats(p_campaign_id UUID)
RETURNS TABLE (
    total_recipients BIGINT,
    sent_count BIGINT,
    delivered_count BIGINT,
    opened_count BIGINT,
    clicked_count BIGINT,
    open_rate DECIMAL,
    click_rate DECIMAL
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COUNT(*) as total_recipients,
        COUNT(*) FILTER (WHERE status IN ('sent', 'delivered', 'opened', 'clicked')) as sent_count,
        COUNT(*) FILTER (WHERE status IN ('delivered', 'opened', 'clicked')) as delivered_count,
        COUNT(*) FILTER (WHERE status IN ('opened', 'clicked')) as opened_count,
        COUNT(*) FILTER (WHERE status = 'clicked') as clicked_count,
        ROUND(100.0 * COUNT(*) FILTER (WHERE status IN ('opened', 'clicked')) / NULLIF(COUNT(*) FILTER (WHERE status IN ('sent', 'delivered', 'opened', 'clicked')), 0), 2) as open_rate,
        ROUND(100.0 * COUNT(*) FILTER (WHERE status = 'clicked') / NULLIF(COUNT(*) FILTER (WHERE status IN ('sent', 'delivered', 'opened', 'clicked')), 0), 2) as click_rate
    FROM email_campaign_recipients
    WHERE campaign_id = p_campaign_id;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- 8. RLS Policies
-- ============================================

ALTER TABLE guest_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_campaign_recipients ENABLE ROW LEVEL SECURITY;

-- Guest ratings policies
CREATE POLICY guest_ratings_tenant_isolation ON guest_ratings
    FOR ALL USING (restaurant_id IN (
        SELECT restaurant_id FROM restaurant_users WHERE id = auth.uid()
    ));

-- Email campaigns policies
CREATE POLICY email_campaigns_tenant_isolation ON email_campaigns
    FOR ALL USING (restaurant_id IN (
        SELECT restaurant_id FROM restaurant_users WHERE id = auth.uid()
    ));

-- Email templates policies
CREATE POLICY email_templates_tenant_isolation ON email_templates
    FOR ALL USING (restaurant_id IN (
        SELECT restaurant_id FROM restaurant_users WHERE id = auth.uid()
    ));

-- Email recipients policies
CREATE POLICY email_recipients_tenant_isolation ON email_campaign_recipients
    FOR ALL USING (campaign_id IN (
        SELECT id FROM email_campaigns WHERE restaurant_id IN (
            SELECT restaurant_id FROM restaurant_users WHERE id = auth.uid()
        )
    ));

-- ============================================
-- 9. Triggers for Updated At
-- ============================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_guest_ratings_updated_at
    BEFORE UPDATE ON guest_ratings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_email_campaigns_updated_at
    BEFORE UPDATE ON email_campaigns
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_email_templates_updated_at
    BEFORE UPDATE ON email_templates
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- 10. Comments
-- ============================================

COMMENT ON TABLE guest_ratings IS 'Stores guest feedback and ratings for visits';
COMMENT ON TABLE email_campaigns IS 'Email marketing campaigns with targeting and analytics';
COMMENT ON TABLE email_templates IS 'Reusable email templates for different campaign types';
COMMENT ON TABLE email_campaign_recipients IS 'Individual recipient tracking for email campaigns';
