// Email Service using Resend integration
import { Resend } from 'resend';

let connectionSettings: any;

async function getCredentials() {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY 
    ? 'repl ' + process.env.REPL_IDENTITY 
    : process.env.WEB_REPL_RENEWAL 
    ? 'depl ' + process.env.WEB_REPL_RENEWAL 
    : null;

  if (!xReplitToken) {
    throw new Error('X_REPLIT_TOKEN not found for repl/depl');
  }

  connectionSettings = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=resend',
    {
      headers: {
        'Accept': 'application/json',
        'X_REPLIT_TOKEN': xReplitToken
      }
    }
  ).then(res => res.json()).then(data => data.items?.[0]);

  if (!connectionSettings || (!connectionSettings.settings.api_key)) {
    throw new Error('Resend not connected');
  }
  return {
    apiKey: connectionSettings.settings.api_key, 
    fromEmail: connectionSettings.settings.from_email
  };
}

// WARNING: Never cache this client.
// Access tokens expire, so a new client must be created each time.
export async function getUncachableResendClient() {
  const { apiKey, fromEmail } = await getCredentials();
  return {
    client: new Resend(apiKey),
    fromEmail
  };
}

export async function sendPasswordResetEmail(
  toEmail: string, 
  resetUrl: string,
  firstName?: string
): Promise<boolean> {
  try {
    const { client, fromEmail } = await getUncachableResendClient();
    
    const name = firstName || 'there';
    
    // Always use the verified deepnewbim.com domain
    const verifiedFromEmail = 'LOD 400 Platform <noreply@deepnewbim.com>';
    
    const { data, error } = await client.emails.send({
      from: verifiedFromEmail,
      to: toEmail,
      subject: 'Reset Your Password - LOD 400 Platform',
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
          <div style="text-align: center; margin-bottom: 40px;">
            <h1 style="color: #1a1a1a; font-size: 28px; margin: 0;">LOD 400 Platform</h1>
          </div>
          
          <div style="background: #ffffff; border: 1px solid #e5e5e5; border-radius: 8px; padding: 32px;">
            <h2 style="color: #1a1a1a; font-size: 20px; margin: 0 0 16px;">Reset Your Password</h2>
            
            <p style="color: #525252; font-size: 16px; line-height: 1.6; margin: 0 0 24px;">
              Hi ${name},
            </p>
            
            <p style="color: #525252; font-size: 16px; line-height: 1.6; margin: 0 0 24px;">
              We received a request to reset your password. Click the button below to create a new password:
            </p>
            
            <div style="text-align: center; margin: 32px 0;">
              <a href="${resetUrl}" style="display: inline-block; background: #d4a853; color: #000000; text-decoration: none; font-weight: 600; padding: 14px 32px; border-radius: 6px; font-size: 16px;">
                Reset Password
              </a>
            </div>
            
            <p style="color: #737373; font-size: 14px; line-height: 1.6; margin: 24px 0 0;">
              This link will expire in 1 hour. If you didn't request a password reset, you can safely ignore this email.
            </p>
          </div>
          
          <div style="text-align: center; margin-top: 32px;">
            <p style="color: #a3a3a3; font-size: 12px; margin: 0;">
              LOD 400 Delivery Platform - Professional BIM Model Upgrades
            </p>
          </div>
        </div>
      `,
    });

    if (error) {
      console.error('Resend error:', error);
      return false;
    }

    console.log(`Password reset email sent to ${toEmail}, id: ${data?.id}`);
    return true;
  } catch (error) {
    console.error('Error sending password reset email:', error);
    return false;
  }
}
