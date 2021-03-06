/*
  Copyright 2018-2020 National Geographic Society

  Use of this software does not constitute endorsement by National Geographic
  Society (NGS). The NGS name and NGS logo may not be used for any purpose without
  written permission from NGS.

  Licensed under the Apache License, Version 2.0 (the "License"); you may not use
  this file except in compliance with the License. You may obtain a copy of the
  License at

      https://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software distributed
  under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR
  CONDITIONS OF ANY KIND, either express or implied. See the License for the
  specific language governing permissions and limitations under the License.
*/

import axios from 'axios';
import { NextFunction, Request, Response } from 'express';
import asyncHandler from 'express-async-handler';
import makeError from 'make-error';

import { SNS_TOPIC_SUBSCRIPTION_ARN } from '../config';
import { ExposedError } from '../errors';
import { getLogger } from '../logging';
import { SuccessResponse } from '../types/response';

export const SubscriptionError = makeError('SubscriptionError', ExposedError);

const logger = getLogger('subscription');

type SnsMessageType = 'SubscriptionConfirmation' | 'Notification';

/**
 * After you subscribe your endpoint, Amazon SNS sends a subscription confirmation
 * message to the endpoint.
 *
 * The code at the endpoint must retrieve the SubscribeURL from the subscription
 * confirmation message and confirm the subscription.
 *
 * Amazon SNS doesn't send messages to an endpoint until the subscription is confirmed.
 * @param req
 * @param res
 * @param next
 */
export const handleSNSMessage = asyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const eventType = req.header('X-Amz-Sns-Message-Type');
  if (!['SubscriptionConfirmation', 'Notification'].includes(eventType)) {
    throw new SubscriptionError(`Unhandled SNS event type: ${eventType}`, 400);
  }

  const topicArn = req.header('X-Amz-Sns-Topic-Arn');
  if (topicArn !== SNS_TOPIC_SUBSCRIPTION_ARN) {
    throw new SubscriptionError(`Unrecognized SNS topic Arn: ${topicArn}`, 400);
  }

  const snsMessage = req.body;
  if (!snsMessage) {
    throw new SubscriptionError('Could not decode SNS message.', 400);
  }
  const messageType: SnsMessageType = snsMessage['Type'];

  if (messageType === 'SubscriptionConfirmation') {
    const subscribeURL = snsMessage['SubscribeURL'];

    // confirm SNS subscription;
    await handleSubscriptionResponse(subscribeURL);

    const statusCode = 200;
    const body: SuccessResponse = { code: statusCode, data: { success: true } };

    return res.status(statusCode).json(body);
  }

  if (messageType === 'Notification') {
    const message = JSON.parse(snsMessage['Message']);
    const unsubscribeURL = snsMessage['UnsubscribeURL'];

    // forward the SNS object to the next middleware;
    res.locals.snsMessage = message;

    return next();
  }
});

/**
 * Confirm SNS subscription URL.
 * @param subscribeURL
 */
const handleSubscriptionResponse = async (subscribeURL: string) => {
  try {
    const response = await axios.get(subscribeURL);
    const statusCode = response.status;

    if (statusCode === 200) {
      logger.debug('Successfully confirmed SNS subscription.');
    } else {
      throw new SubscriptionError(
        `Failed to confirm SNS subscription. Received response ${statusCode} from: ${subscribeURL}`,
        500
      );
    }
  } catch (err) {
    logger.error(err);
    if (err instanceof SubscriptionError) {
      throw err;
    }
  }
};
